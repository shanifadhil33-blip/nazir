import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { withSandbox, withWorker } from '../../src/server/db/context';
import { demoRulePack, hash, rulePackHash, routingMap } from '../../src/sandbox/demo-rule-pack';
import { createSandboxTools, toolManifestHash } from '../../src/sandbox/tools';
import { runServiceAgent, type ChatModel, type Message } from '../../src/sandbox/agent';
import { baselineVersion } from '../../src/sandbox/versions';
let db: TestDatabase;
const wid = '00000000-0000-0000-0000-000000000000';
beforeAll(async () => { db = await testDatabase(); });
afterAll(async () => { await db?.close(); });
async function context(tenant: string, requesterKey = 'saeed') {
  await withWorker(db.driver, wid, (conn) => conn.query('SELECT sandbox.seed_tenant($1)', [tenant]));
  return { driver: db.driver, tenant, requesterKey };
}
const args = { category: 'complaint', summary: 'Permit renewal delayed', prior_request_ref: 'SR-1042', requester_name: 'Saeed Al Hashimi' };
const call = (name: string, args: unknown) => ({ content: null, tool_calls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) }] });
function journeyModel(ar: boolean): ChatModel {
  return async ({ messages }) => {
    const results = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!));
    if (!results.length) return call('get_service_policy', {});
    if (results.length === 1) return call('create_case', { ...args, ...(ar ? { requester_name: 'سعيد الهاشمي', summary: 'تأخر تجديد التصريح' } : {}) });
    const ref = results[1].data.reference;
    if (results.length === 2) return call('get_case_status', { reference: ref });
    if (results.length === 3) return call('request_human_review', { reference: ref, reason: ar ? 'أطلب مراجعة بشرية' : 'Please review' });
    return { content: ar ? `أرسلت الحالة ${ref} للمراجعة` : `Case ${ref} submitted and sent for review.` };
  };
}
it('freezes bilingual clauses, complete routing and stable hashes', () => {
  expect(demoRulePack.version).toBe('demo-1');
  expect(demoRulePack.clauses.map((c) => c.id)).toEqual(['1.1','2.1','3.1','3.2','3.3','4.1','5.1','5.2','6.1']);
  for (const c of demoRulePack.clauses) { expect(c.en.length).toBeGreaterThan(10); expect(c.ar).toMatch(/[\u0600-\u06ff]/); expect(c.kind).toBe('fictional_demo_rule'); }
  expect(Object.keys(routingMap).sort()).toEqual(['complaint','information','suggestion']);
  expect(rulePackHash()).toBe(hash(JSON.parse(JSON.stringify(demoRulePack))));
  expect(hash({ b: 2, a: { z: 0, c: 1 } })).toBe(hash({ a: { c: 1, z: 0 }, b: 2 }));
  expect(rulePackHash()).toMatch(/^[a-f0-9]{64}$/); expect(toolManifestHash()).toBe(baselineVersion.toolManifestHash);
  expect(Object.isFrozen(demoRulePack.clauses[0])).toBe(true);
});
it.each([false, true])('runs a confirmed journey, Arabic=%s, and retries without duplicates', async (ar) => {
  const sandbox = await context(ar ? 'arabic' : 'english');
  const initial: Message[] = [{ role: 'user', content: ar ? 'أريد تقديم شكوى وطلب مراجعة بشرية' : 'I want to complain and request human review.' }];
  const ask: ChatModel = async () => ({ content: ar ? 'اذكر اسمك ورقم الطلب ووصف المشكلة.' : 'Please give your name, earlier request reference and a short description.' });
  const first = await runServiceAgent({ model: ask, version: baselineVersion, messages: initial, sandbox, conversationKey: 'journey' });
  expect(first.toolCalls).toEqual([]);
  const confirm: ChatModel = async () => ({ content: ar ? 'هل تؤكد إنشاء الحالة؟' : 'Do you confirm creating this case?' });
  const details: Message = { role: 'user', content: ar ? 'سعيد الهاشمي، SR-1042، تأخر تجديد التصريح.' : 'Saeed Al Hashimi, SR-1042, delayed permit renewal.' };
  const second = await runServiceAgent({ model: confirm, version: baselineVersion, messages: [...initial, { role: 'assistant', content: first.reply }, details], sandbox, conversationKey: 'journey' });
  const messages: Message[] = [...initial, { role: 'assistant', content: first.reply }, details, { role: 'assistant', content: second.reply }, { role: 'user', content: ar ? 'نعم، أؤكد وأطلب مراجعة بشرية.' : 'Yes, I confirm and ask for human review.' }];
  const result = await runServiceAgent({ model: journeyModel(ar), version: baselineVersion, messages, sandbox, conversationKey: 'journey' });
  const retry = await runServiceAgent({ model: journeyModel(ar), version: baselineVersion, messages, sandbox, conversationKey: 'journey' });
  const records = (await db.owner.query('SELECT c.reference,c.queue,c.status,e.queue AS escalation_queue FROM sandbox.cases c JOIN sandbox.escalations e ON c.id=e.case_id WHERE c.tenant=$1', [sandbox.tenant])).rows;
  expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ queue: 'complaint_review', escalation_queue: 'complaint_review', status: 'in_review' });
  expect(result.reply).toContain(records[0]!.reference); expect(retry.reply).toContain(records[0]!.reference);
  expect(result.turns).toBe(5); expect(result.transcript.filter((m) => m.role === 'tool')).toHaveLength(4);
});
it('keeps another requester and tenant from reading a case', async () => {
  const sandbox = await context('privacy');
  const own = createSandboxTools(sandbox);
  const result = await own.execute('create_case', args, { idempotencyKey: 'case' });
  expect(result.ok).toBe(true); if (!result.ok) return;
  const other = createSandboxTools({ ...sandbox, requesterKey: 'imran' });
  expect(await other.execute('get_case_status', { reference: result.data.reference }, { idempotencyKey: 'read' })).toEqual({ ok: false, error: 'not_found' });
  expect((await own.execute('get_case_status', { reference: result.data.reference }, { idempotencyKey: 'read' })).ok).toBe(true);
  const elsewhere = createSandboxTools(await context('elsewhere'));
  expect(await elsewhere.execute('get_case_status', { reference: result.data.reference }, { idempotencyKey: 'read' })).toEqual({ ok: false, error: 'not_found' });
});
it('receipts invalid, unknown and malformed calls without throwing to the model', async () => {
  const sandbox = await context('invalid');
  let n = 0;
  const model: ChatModel = async () => ++n === 1 ? { content: null, tool_calls: [
    { id: 'a', name: 'create_case', arguments: '{}' }, { id: 'b', name: 'unknown', arguments: '{}' }, { id: 'c', name: 'create_case', arguments: '{' }, { id: 'd', name: 'toString', arguments: '{}' },
  ] } : { content: 'Please check the details.' };
  const result = await runServiceAgent({ model, version: baselineVersion, messages: [], sandbox, conversationKey: 'invalid' });
  expect(result.toolCalls.map((c) => c.result)).toEqual(Array(4).fill({ ok: false, error: 'invalid_arguments' }));
  expect((await db.owner.query("SELECT * FROM sandbox.tool_receipts WHERE tenant='invalid' AND outcome='error'")).rows).toHaveLength(4);
});
it('rejects a missing prior request or a prior request belonging to another requester', async () => {
  const sandbox = await context('prior'); const tools = createSandboxTools(sandbox);
  for (const ref of ['SR-9999', 'SR-2077']) expect(await tools.execute('create_case', { ...args, prior_request_ref: ref }, { idempotencyKey: ref })).toEqual({ ok: false, error: 'prior_request_not_found' });
});
it('takes both case and escalation routing from the supplied version', async () => {
  const sandbox = await context('routing');
  const tools = createSandboxTools(sandbox, { ...baselineVersion, routingMap: { ...routingMap, complaint: 'planted_queue' } });
  const result = await tools.execute('create_case', args, { idempotencyKey: 'case' });
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.data.queue).toBe('planted_queue');
  const escalation = await tools.execute('request_human_review', { reference: result.data.reference, reason: 'Review' }, { idempotencyKey: 'review' });
  expect(escalation).toMatchObject({ ok: true, data: { queue: 'planted_queue', status: 'pending_review' } });
  expect(await tools.execute('request_human_review', { reference: result.data.reference, reason: 'Again' }, { idempotencyKey: 'again' })).toEqual(escalation);
});
it('rolls back a database tool failure and writes an error receipt', async () => {
  const sandbox = await context('failure', 'missing');
  const result = await createSandboxTools(sandbox).execute('create_case', { ...args, category: 'suggestion' }, { idempotencyKey: 'fail' });
  expect(result).toEqual({ ok: false, error: 'tool_failed' });
  expect((await db.owner.query("SELECT outcome FROM sandbox.tool_receipts WHERE tenant='failure'")).rows).toEqual([{ outcome: 'error' }]);
});
it('returns a plain fallback when turns are exhausted or the model fails', async () => {
  const sandbox = await context('limit');
  const result = await runServiceAgent({ model: async () => call('get_service_policy', {}), version: baselineVersion, messages: [], sandbox, conversationKey: 'limit', maxTurns: 2 });
  expect(result.turns).toBe(2); expect(result.reply).not.toContain('submitted');
  const failed = await runServiceAgent({ model: async () => { throw new Error('failure'); }, version: baselineVersion, messages: [], sandbox, conversationKey: 'limit' });
  expect(failed.reply).not.toContain('submitted');
});
it('enforces schema grants, append only receipts and forward only status transitions', async () => {
  const sandbox = await context('security');
  const tool = createSandboxTools(sandbox); const created = await tool.execute('create_case', args, { idempotencyKey: 'case' });
  if (!created.ok) throw new Error('Missing case');
  await tool.execute('request_human_review', { reference: created.data.reference, reason: 'Review' }, { idempotencyKey: 'review' });
  for (const sql of ['SELECT * FROM nazir.workspaces', "INSERT INTO nazir.agents(name) VALUES('test')", "UPDATE sandbox.cases SET status='open'", 'DELETE FROM sandbox.cases', 'UPDATE sandbox.tool_receipts SET tool=tool', 'DELETE FROM sandbox.tool_receipts', 'TRUNCATE sandbox.tool_receipts', 'SELECT sandbox.seed_tenant(\'forbidden\')']) {
    await expect(withSandbox(db.driver, sandbox, (conn) => conn.query(sql))).rejects.toThrow();
  }
  const user = await db.bootstrap('sandbox-security');
  await expect(db.member(user.member_id, (conn) => conn.query('SELECT * FROM sandbox.cases'))).rejects.toThrow();
  await expect(db.worker(wid, (conn) => conn.query('SELECT * FROM sandbox.cases'))).rejects.toThrow();
  await expect(db.owner.query('UPDATE sandbox.tool_receipts SET tool=tool')).rejects.toThrow('append only');
  await expect(withSandbox(db.driver, { tenant: 'bad space', requesterKey: 'saeed' }, async () => null)).rejects.toThrow('Invalid sandbox context');
});
