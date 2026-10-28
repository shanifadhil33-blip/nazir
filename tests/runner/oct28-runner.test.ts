import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { fixture, type Fixture } from './helpers';
import { installPack, approvePackCases } from '../../src/server/packs/install';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { runNextConversation } from '../../src/server/runner/worker';
import * as shopTools from '../../src/sandbox/shop/tools';
import type { ToolResult } from '../../src/sandbox/tools';
import type { ChatModel } from '../../src/sandbox/agent';
import shopCases from '../../src/server/packs/ecommerce/cases.json';

let db: TestDatabase;
let f: Fixture;
let version: string;
let cases: { id: string; stable_key: string }[];
beforeAll(async () => {
  db = await testDatabase();
  f = await fixture(db, 'October 28 bounded worker');
  const owner = (await db.owner.query<{ id: string }>('SELECT id FROM nazir.members WHERE workspace_id=$1 ORDER BY created_at LIMIT 1', [f.workspaceId])).rows[0]!.id;
  const reviewer = await db.createMember(f.workspaceId, ['quality_reviewer']);
  const installed = await installPack(db.driver, owner, 'ecommerce');
  version = installed.versionIds.shop_baseline!;
  await approvePackCases(db.driver, reviewer, 'ecommerce');
  cases = (await db.owner.query<{ id: string; stable_key: string }>("SELECT id,stable_key FROM nazir.scenarios WHERE workspace_id=$1 AND stable_key=ANY($2::text[]) ORDER BY stable_key", [f.workspaceId, ['ec_promo_code_trap_ar', 'ec_cancel_order_trap_ar', 'ec_return_window_normal_ar']])).rows;
  expect(cases).toHaveLength(3);
}, 120000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await db?.close(); });
const never = <T>() => new Promise<T>(() => {});
async function enqueue(recordsOnly = true) {
  const run = await enqueueRun(db.driver, { workspaceId: f.workspaceId, planId: f.planId, agentVersionId: version, scenarioIds: cases.map((c) => c.id), repeats: 1, idempotencyKey: crypto.randomUUID(), recordsOnly });
  await db.owner.query('UPDATE nazir.conversations SET max_attempts=1 WHERE run_id=$1', [run.id]);
  return run;
}
// A separate harness deadline exposes a stuck worker without hanging the test.
async function guarded<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<'worker_hung'>((resolve) => { timer = setTimeout(() => resolve('worker_hung'), 1500); })]); }
  finally { clearTimeout(timer!); }
}
const call = (name: string, args: unknown) => ({ content: null, tool_calls: [{ id: 'blocked', name, arguments: JSON.stringify(args) }] });

it('10 bounds never resolving ecommerce tools for all three live cases and finishes the run', async () => {
  const run = await enqueue();
  const blocked = vi.fn<(name: string, args: unknown, options: { idempotencyKey: string; guard?: boolean }) => Promise<ToolResult>>(() => never<ToolResult>());
  vi.spyOn(shopTools, 'createShopTools').mockReturnValue({ execute: blocked });
  const model: ChatModel = async ({ messages }) => {
    const user = messages.filter((m) => m.role === 'user').at(-1)!.content!;
    const c = shopCases.cases.find((c) => c.resident_turns.includes(user))!;
    if (c.stable_key === 'promo_code_trap_ar') return call('check_promo', { code: 'SAVE50', order_reference: 'OR1001' });
    if (c.stable_key === 'cancel_order_trap_ar') return call('create_request', { kind: 'cancellation', order_reference: c.expected.unit, summary: 'طلب إلغاء / Cancellation request' });
    return call('get_order', { reference: c.expected.unit });
  };
  for (let i = 0; i < cases.length; i++) {
    const result = await guarded(runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'oct28_hung_tool', runId: run.id, conversationTimeoutMs: 200, chatModelFactory: () => model }));
    expect(result).not.toBe('worker_hung');
    expect(result).toMatchObject({ status: 'inconclusive', reason: 'timeout' });
  }
  expect(blocked).toHaveBeenCalledTimes(3);
  expect(blocked.mock.calls.map((args) => args[0]).sort()).toEqual(['check_promo', 'create_request', 'get_order']);
  expect((await db.owner.query('SELECT status,inconclusive_reason FROM nazir.conversations WHERE run_id=$1', [run.id])).rows).toEqual(Array.from({ length: 3 }, () => ({ status: 'inconclusive', inconclusive_reason: 'timeout' })));
  const summaries = (await db.owner.query<{ result_summary: { timeout: { en: string; ar: string }; timeoutMs: number } }>('SELECT result_summary FROM nazir.conversations WHERE run_id=$1', [run.id])).rows;
  for (const { result_summary } of summaries) {
    expect(result_summary).toMatchObject({ timeoutMs: 200, timeout: { en: 'Conversation exceeded its time limit.', ar: 'تجاوزت المحادثة المهلة المحددة.' } });
  }
  expect((await db.owner.query('SELECT status,finished_at FROM nazir.runs WHERE id=$1', [run.id])).rows[0]).toMatchObject({ status: 'inconclusive', finished_at: expect.anything() });
  expect(await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'oct28_finished', runId: run.id, chatModelFactory: () => model })).toBeNull();
});

it('10 bounds a provider that never resolves and exhausts finite retries', async () => {
  const run = await enqueue();
  await db.owner.query('UPDATE nazir.conversations SET max_attempts=2 WHERE run_id=$1', [run.id]);
  const model = vi.fn(() => never<Awaited<ReturnType<ChatModel>>>());
  for (let i = 0; i < cases.length * 2; i++) {
    const result = await guarded(runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'oct28_hung_provider', runId: run.id, conversationTimeoutMs: 200, chatModelFactory: () => model }));
    expect(result).not.toBe('worker_hung');
    expect(result).toMatchObject({ reason: 'timeout' });
    await db.owner.query('UPDATE nazir.conversations SET available_at=now() WHERE run_id=$1 AND status=\'queued\'', [run.id]);
  }
  expect(model).toHaveBeenCalledTimes(6);
  expect((await db.owner.query('SELECT status,attempt FROM nazir.conversations WHERE run_id=$1', [run.id])).rows).toEqual(Array.from({ length: 3 }, () => ({ status: 'inconclusive', attempt: 2 })));
  expect((await db.owner.query('SELECT status FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!.status).toBe('inconclusive');
});

it('10 bounds a judge that never resolves, with a clear timeout reason', async () => {
  const run = await enqueue(false);
  const judge = vi.fn(() => never<never>());
  const result = await guarded(runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'oct28_hung_judge', runId: run.id, conversationTimeoutMs: 200, chatModelFactory: () => async () => ({ content: 'لا أستطيع تعديل السجل. I cannot change the record.' }), judgeFactory: () => judge }));
  expect(judge).toHaveBeenCalled();
  expect(result).toMatchObject({ status: 'inconclusive', reason: 'timeout' });
});
