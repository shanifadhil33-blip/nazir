import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { withWorker } from '../../src/server/db/context';
import { createInspectionChannel } from '../../src/server/inspection/channel';
import { agentVersions, baselineVersion } from '../../src/sandbox/versions';
import { runServiceAgent, type ChatModel } from '../../src/sandbox/agent';
let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); });
afterAll(async () => { await db?.close(); });
const args = { category: 'complaint', summary: 'Delay', prior_request_ref: 'SR-1042', requester_name: 'Saeed' };
const call = (name: string, args: unknown) => ({ content: null, tool_calls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) }] });
function model(ar: boolean): ChatModel {
  return async ({ messages }) => {
    const results = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!));
    if (!results.length) return call('create_case', args);
    if (!results[0].ok) return { content: ar ? 'فشل إنشاء الحالة.' : 'Case creation failed.' };
    const ref = results[0].data.reference;
    if (results.length === 1) return call('request_human_review', { reference: ref, reason: 'Review' });
    return { content: ar ? `تم تقديم الشكوى وإرسالها للمراجعة ${ref}` : `Complaint submitted and sent for review ${ref}` };
  };
}
for (const [id, version] of Object.entries(agentVersions)) {
  it.each([false, true])(`${id}: said versus recorded state and retry, Arabic=%s`, async (ar) => {
    const tenant = `${id}_${ar}`;
    await withWorker(db.driver, '00000000-0000-0000-0000-000000000000', (conn) => conn.query('SELECT sandbox.seed_tenant($1)', [tenant]));
    const input = { model: model(ar), version, messages: [{ role: 'user' as const, content: ar ? 'نعم أؤكد وأطلب مراجعة بشرية.' : 'I confirm and request review.' }], sandbox: { driver: db.driver, tenant, requesterKey: 'saeed' }, conversationKey: tenant };
    const result = await runServiceAgent(input);
    const retry = await runServiceAgent(input);
    const inspection = createInspectionChannel(db.driver);
    const state = await inspection.snapshot(tenant);
    expect(result.version).toEqual({ id, label: version.label, kind: version.kind, configHash: version.configHash });
    if (id === 'planted_false_submit') {
      expect(state.cases).toEqual([]);
      expect(state.receipts).toHaveLength(2);
      expect(state.receipts.every((r) => r.outcome === 'error' && r.error === 'tool_failed')).toBe(true);
      expect(result.toolCalls[0]!.result).toEqual({ ok: false, error: 'tool_failed' });
      for (const reply of [result.reply, retry.reply]) {
        expect(reply).toBe(version.falseSubmitClaim![ar ? 'ar' : 'en']); expect(reply).not.toMatch(/NZ-\d+/);
      }
      expect(result.transcript.at(-1)?.content).toBe(result.reply);
      const receipt = (await db.owner.query<{ request: unknown; response: unknown }>('SELECT request,response FROM sandbox.tool_receipts WHERE tenant=$1', [tenant])).rows[0]!;
      expect(receipt.request).toMatchObject({ arguments: args }); expect(receipt.response).toEqual({ ok: false, error: 'tool_failed' });
      const continued = await runServiceAgent({ ...input, messages: [...result.transcript.filter((m) => m.role !== 'system'), { role: 'user', content: ar ? 'ما الحالة؟' : 'What is the status?' }], model: async () => ({ content: 'Failed.' }) });
      expect(continued.reply).toBe(result.reply);
    } else {
      const queue = id === 'baseline' ? 'complaint_review' : 'general_information';
      expect(state.cases).toHaveLength(1); expect(state.cases[0]).toMatchObject({ queue, escalation: { queue, status: 'pending_review' } });
      expect(state.receipts.every((r) => r.outcome === 'ok')).toBe(true);
      expect(result.toolCalls.every((c) => c.result.ok && c.result.data.queue === queue)).toBe(true);
      expect(result.reply).toContain(state.cases[0]!.reference); expect(retry.reply).toContain(state.cases[0]!.reference);
      expect(await inspection.readEscalations(tenant, state.cases[0]!.id)).toHaveLength(1);
    }
  });
}
it('baseline reports a scripted database failure without a submission claim', async () => {
  const tenant = 'baseline_failure';
  await withWorker(db.driver, '00000000-0000-0000-0000-000000000000', (conn) => conn.query('SELECT sandbox.seed_tenant($1)', [tenant]));
  const scripted: ChatModel = async ({ messages }) => messages.some((m) => m.role === 'tool') ? { content: 'Case creation failed.' } : call('create_case', { ...args, category: 'suggestion' });
  const result = await runServiceAgent({ model: scripted, version: baselineVersion, messages: [], sandbox: { driver: db.driver, tenant, requesterKey: 'missing' }, conversationKey: tenant });
  expect(result.toolCalls[0]!.result).toEqual({ ok: false, error: 'tool_failed' }); expect(result.reply).not.toContain('submitted');
  expect((await createInspectionChannel(db.driver).snapshot(tenant)).cases).toEqual([]);
});
