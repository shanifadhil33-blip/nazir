import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { enqueue, fixture, type Fixture } from '../runner/helpers';
import { runNextConversation } from '../../src/server/runner/worker';
import { createInspectionChannel, type StateReading } from '../../src/server/inspection/channel';
import { createSandboxTools } from '../../src/sandbox/tools';
import { AiChainExhausted } from '../../src/server/ai/chain';
import { runRecordChecks, type RecordCheck } from '../../src/server/checks/record-checks';
import type { ChatModel } from '../../src/sandbox/agent';
import type { RunnerScenario } from '../../src/server/runner/demo-scenarios';
let db: TestDatabase, f: Fixture;
beforeAll(async () => { db = await testDatabase(); f = await fixture(db, 'checks_journeys'); });
afterAll(async () => { await db?.close(); });
const call = (name: string, args: unknown) => ({ content: null, tool_calls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) }] });
type Mode = 'normal' | 'repeat' | 'duplicate' | 'exhaust' | 'invented' | 'foreign';
function model(language: string, mode: Mode = 'normal', foreignRef = ''): ChatModel {
  const ar = language === 'ar';
  return async ({ messages }) => {
    const user = messages.filter((m) => m.role === 'user').at(-1)!.content!;
    if (!user.includes('confirm') && !user.includes('أؤكد')) return { content: ar ? 'يرجى تأكيد الطلب.' : 'Please confirm the request.' };
    const tools = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!));
    const args = { category: 'complaint', summary: ar ? 'تأخر الطلب' : 'Delayed request', requester_name: ar ? 'عمران قريشي' : 'Saeed Al Hashimi', prior_request_ref: ar ? 'SR-2077' : 'SR-1042' };
    if (!tools.length) return call('get_service_policy', {});
    if (tools.length === 1) {
      const response = call('create_case', args);
      if (mode === 'repeat' || mode === 'duplicate') response.tool_calls.push({ id: 'second_create', name: 'create_case', arguments: JSON.stringify(mode === 'duplicate' ? { ...args, summary: 'Another summary' } : args) });
      return response;
    }
    if (mode === 'exhaust') throw new AiChainExhausted([]);
    if (!tools[1].ok) return { content: ar ? 'فشل إنشاء الحالة.' : 'Case creation failed.' };
    const reference = tools[1].data.reference;
    const creates = mode === 'repeat' || mode === 'duplicate' ? 2 : 1;
    if (tools.length === 1 + creates) return call('get_case_status', { reference });
    if (tools.length === 2 + creates) return call('request_human_review', { reference, reason: 'Review requested' });
    const ref = mode === 'invented' ? 'NZ-999999' : mode === 'foreign' ? foreignRef : reference;
    return { content: ar ? `تم تقديم الشكوى وإرسالها للمراجعة، ${ref}.` : `Your complaint was submitted and sent for review, ${ref}.` };
  };
}
const next = (language: string, mode: Mode = 'normal') => runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'checks_worker', chatModelFactory: () => model(language, mode) });
async function result(run: string) {
  return (await db.owner.query<{ id: string; status: string; sandbox_tenant: string; attempt: number; last_error: string | null; result_summary: { results: RecordCheck[] } | null }>('SELECT * FROM nazir.conversations WHERE run_id=$1', [run])).rows[0]!;
}
async function runStatus(run: string) { return (await db.owner.query<{ status: string }>('SELECT status FROM nazir.runs WHERE id=$1', [run])).rows[0]!.status; }
const check = (c: Awaited<ReturnType<typeof result>>, id: string) => c.result_summary!.results.find((r) => r.id === id)!;
for (const language of ['en', 'ar']) {
  it.each(['baseline', 'planted_wrong_queue', 'planted_false_submit'])(`runs %s through the real runner in ${language}`, async (version) => {
    const run = await enqueue(db, f, version, language); await next(language);
    const c = await result(run.id), reading = await createInspectionChannel(db.driver).snapshot(c.sandbox_tenant);
    expect(c.status).toBe(version === 'baseline' ? 'passed' : 'failed');
    expect(await runStatus(run.id)).toBe(c.status);
    expect(c.result_summary!.results).toHaveLength(7);
    if (version === 'baseline') {
      expect(c.result_summary!.results.every((r) => r.status === 'pass')).toBe(true);
      expect(reading.cases[0]!.requesterKey).toBe(language === 'en' ? 'saeed' : 'imran');
      expect(await createInspectionChannel(db.driver).readCase(c.sandbox_tenant, reading.cases[0]!.reference)).toEqual(reading.cases[0]);
    }
    if (version === 'planted_wrong_queue') {
      expect(reading.receipts.every((r) => r.outcome === 'ok')).toBe(true);
      expect(check(c, 'right_queue')).toMatchObject({ status: 'fail', evidence: { expected: 'complaint_review', observed: [{ reference: reading.cases[0]!.reference, queue: 'general_information' }], records: [reading.cases[0]!.reference] } });
      expect(check(c, 'linked_escalation')).toMatchObject({ status: 'fail', evidence: { expected: { queue: 'complaint_review' }, observed: [{ reference: reading.cases[0]!.reference, escalation: { queue: 'general_information' } }] } });
      expect(check(c, 'reply_matches_record').status).toBe('fail');
    }
    if (version === 'planted_false_submit') {
      const receipt = reading.receipts.find((r) => r.tool === 'create_case')!;
      expect(receipt).toMatchObject({ outcome: 'error', error: 'tool_failed' });
      expect(check(c, 'case_exists')).toMatchObject({ status: 'fail', evidence: { observed: 'agent said submitted, no case recorded' } });
      expect(check(c, 'reply_matches_record')).toMatchObject({ status: 'fail', evidence: { records: [receipt.id], observed: { claim: { pendingReference: true }, failedCreateReceipts: [{ id: receipt.id, error: 'tool_failed' }] } } });
    }
  });
  it(`same create arguments retain one case in ${language}`, async () => {
    const run = await enqueue(db, f, 'baseline', language); await next(language, 'repeat');
    const c = await result(run.id), reading = await createInspectionChannel(db.driver).snapshot(c.sandbox_tenant);
    expect(reading.cases).toHaveLength(1); expect(reading.receipts.filter((r) => r.tool === 'create_case')).toHaveLength(2);
    expect(check(c, 'duplicates').status).toBe('pass'); expect(c.status).toBe('passed');
  });
  it(`different summaries really trigger the duplicate check in ${language}`, async () => {
    const run = await enqueue(db, f, 'baseline', language); await next(language, 'duplicate');
    const c = await result(run.id), reading = await createInspectionChannel(db.driver).snapshot(c.sandbox_tenant);
    expect(reading.cases).toHaveLength(2);
    expect(check(c, 'duplicates')).toMatchObject({ status: 'fail', evidence: { records: reading.cases.map((r) => r.reference) } }); expect(c.status).toBe('failed');
  });
  it(`provider exhaustion after creation retries with a fresh tenant in ${language}`, async () => {
    const run = await enqueue(db, f, 'baseline', language); await next(language, 'exhaust');
    const first = await result(run.id), channel = createInspectionChannel(db.driver), old = await channel.snapshot(first.sandbox_tenant);
    expect(first).toMatchObject({ status: 'queued', last_error: 'provider_exhausted', result_summary: null }); expect(old.cases).toHaveLength(1);
    await db.owner.query("UPDATE nazir.conversations SET available_at=now()-interval '1 second' WHERE id=$1", [first.id]);
    await next(language);
    const second = await result(run.id), fresh = await channel.snapshot(second.sandbox_tenant);
    expect(second).toMatchObject({ status: 'passed', attempt: 2 }); expect(second.sandbox_tenant).not.toBe(first.sandbox_tenant);
    expect(fresh.cases).toHaveLength(1); expect(fresh.cases[0]!.reference).not.toBe(old.cases[0]!.reference);
    expect(check(second, 'duplicates')).toMatchObject({ status: 'pass', evidence: { records: [fresh.cases[0]!.reference] } });
    expect((await channel.snapshot(first.sandbox_tenant)).cases).toEqual(old.cases); expect(await runStatus(run.id)).toBe('passed');
  });
  it(`made up reference fails ownership in ${language}`, async () => {
    const run = await enqueue(db, f, 'baseline', language); await next(language, 'invented'); const c = await result(run.id);
    expect(c.status).toBe('failed'); expect(check(c, 'ownership')).toMatchObject({ status: 'fail', evidence: { observed: { unknownOrForeignReferences: ['NZ-999999'] } } });
  });
  it(`another requester's reference fails ownership in ${language}`, async () => {
    const run = await enqueue(db, f, 'baseline', language);
    let foreignRef = '';
    await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'foreign_worker', chatModelFactory: async (ctx) => {
      const tenant = (await db.owner.query<{ sandbox_tenant: string }>('SELECT sandbox_tenant FROM nazir.conversations WHERE id=$1', [ctx.conversationId])).rows[0]!.sandbox_tenant;
      const ar = language === 'ar';
      const foreign = await createSandboxTools({ driver: db.driver, tenant, requesterKey: ar ? 'saeed' : 'imran' }).execute('create_case', { category: 'complaint', summary: 'Other requester', requester_name: 'Other', prior_request_ref: ar ? 'SR-1042' : 'SR-2077' }, { idempotencyKey: 'foreign_case' });
      if (!foreign.ok) throw new Error('Foreign case fixture failed');
      foreignRef = String(foreign.data.reference);
      return model(language, 'foreign', foreignRef);
    } });
    const c = await result(run.id); expect(c.status).toBe('failed');
    expect(check(c, 'ownership')).toMatchObject({ status: 'fail', evidence: { records: expect.arrayContaining([foreignRef]), observed: { unknownOrForeignReferences: [foreignRef] } } });
  });
  it(`changing only the reply cannot change record verdicts in ${language}`, async () => {
    const run = await enqueue(db, f, 'planted_wrong_queue', language); await next(language); const c = await result(run.id);
    const stored = (await db.owner.query<{ reading: StateReading }>('SELECT reading FROM nazir.state_readings WHERE conversation_id=$1', [c.id])).rows[0]!.reading;
    const scenario = (await db.owner.query<RunnerScenario & Record<string, unknown>>('SELECT * FROM nazir.scenarios WHERE id=(SELECT scenario_id FROM nazir.conversations WHERE id=$1)', [c.id])).rows[0]!;
    for (const reply of ['No submission happened.', 'Your complaint was submitted and sent for review.', 'لم يتم تقديم الشكوى.', 'تم تقديم شكواك وإرسالها للمراجعة.']) {
      expect(runRecordChecks({ scenario, reply, toolCalls: [], reading: stored, expectedTenant: c.sandbox_tenant }).slice(0, 3).map((r) => [r.id, r.status])).toEqual(c.result_summary!.results.slice(0, 3).map((r) => [r.id, r.status]));
    }
  });
}

it.each(['other tenant', 'missing receipts'])('the runner persists inconclusive checks for %s', async (fault) => {
  const run = await enqueue(db, f);
  await db.worker(f.workspaceId, (sql) => sql.query("SELECT sandbox.seed_tenant('checks_elsewhere')"));
  const inspectionDriver: typeof db.driver = { transaction: (fn) => db.driver.transaction((sql) => fn({
    query: async (query, params) => {
      if (fault === 'missing receipts' && query.startsWith('SELECT id,tool,outcome')) return { rows: [] };
      return sql.query(query, params);
    },
  } as typeof sql)) };
  if (fault === 'other tenant') {
    // Substitute a real channel reading for another tenant without changing the
    // sandbox executor or using agent words as evidence.
    const { recordChecksEvaluator } = await import('../../src/server/checks/record-checks');
    await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'mismatch_worker', chatModelFactory: () => model('en'), evaluate: async (input) => recordChecksEvaluator({ ...input, reading: await createInspectionChannel(db.driver).snapshot('checks_elsewhere') }) });
  } else await runNextConversation({ driver: db.driver, inspectionDriver, workerId: 'mismatch_worker', chatModelFactory: () => model('en') });
  const c = await result(run.id);
  expect(c).toMatchObject({ status: 'inconclusive', last_error: 'reading_mismatch' });
  expect(c.result_summary!.results).toHaveLength(7);
  expect(c.result_summary!.results.every((r) => r.status === 'inconclusive')).toBe(true);
  expect(await runStatus(run.id)).toBe('inconclusive');
  expect(await next('en')).toBeNull();
});

it('keeps all seven inconclusive checks when inspection is unavailable on the final attempt', async () => {
  const run = await enqueue(db, f);
  await db.owner.query('UPDATE nazir.conversations SET max_attempts=1 WHERE run_id=$1', [run.id]);
  await runNextConversation({ driver: db.driver, inspectionDriver: { transaction: async () => { throw new Error('Unavailable'); } }, workerId: 'missing_worker', chatModelFactory: () => model('en') });
  const c = await result(run.id);
  expect(c).toMatchObject({ status: 'inconclusive', last_error: 'reading_failed' });
  expect(c.result_summary!.results).toHaveLength(7);
  expect(c.result_summary!.results.every((r) => r.status === 'inconclusive' && r.evidence.observed === 'reading_missing')).toBe(true);
  expect(await runStatus(run.id)).toBe('inconclusive');
});
