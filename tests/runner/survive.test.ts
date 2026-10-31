import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { fixture, journey, type Fixture } from './helpers';
import { runNextConversation, type Verdict } from '../../src/server/runner/worker';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { cancelPlan, cancelRunAsMember } from '../../src/server/runner/cancel';
import { recoverStale } from '../../src/server/runner/recover';
import { assertRunCap, maxRunsPerUserPerDay, runStarter } from '../../src/server/runner/run-cap';
import { runNotes, stepRun } from '../../src/server/livetest/drive';
import type { StepDeps } from '../../src/server/livetest/live-test';
import { resetDemosDue } from '../../src/server/demo/reset';
import { createAiChain } from '../../src/server/ai/chain';
import { chainChatModel } from '../../src/server/ai/chat-model';
import { memoryAiStore } from '../../src/server/ai/store';
import { errorLines, mapError, runReasonLine } from '../../src/server/http/errors';
import { readAuditChain, verifyAuditChain } from '../../src/server/audit/verify';
import type { ChatModel } from '../../src/sandbox/agent';
import type { TransactionDriver } from '../../src/server/db/driver';

let db: TestDatabase, f: Fixture, owner: string, reviewer: string, supplier: string, viewer: string;
const ready = { INSPECT_DATABASE_URL: 'postgres://synthetic', ZAI_API_KEY: 'synthetic' };
const passed = (): Verdict => ({ status: 'passed', results: { checks: 1 } });
const hasDash = (text: string) => / - |–|—/.test(text);
const enqueue = (repeats = 1, startedBy?: Awaited<ReturnType<typeof runStarter>>, key: string = crypto.randomUUID(), wf: Fixture = f) =>
  enqueueRun(db.driver, { workspaceId: wf.workspaceId, planId: wf.planId, agentVersionId: wf.versions.find((v) => v.registry_id === 'baseline')!.id, scenarioIds: wf.scenarios.filter((s) => s.language === 'en').map((s) => s.id), repeats, idempotencyKey: key, ...(startedBy ? { startedBy } : {}) });
/** The in request step, as production runs it, with scripted model and verdict and no network. */
const deps = (extra: Partial<Parameters<typeof runNextConversation>[0]> = {}, driver?: () => TransactionDriver): StepDeps => ({
  inspectionDriver: () => db.driver,
  run: ({ runId }) => runNextConversation({ driver: driver ? driver() : db.driver, inspectionDriver: db.driver, runId, workerId: 'live_test', chatModelFactory: () => journey(), evaluate: passed, ...extra }),
});
/** A database that drops the connection once, in the middle of the step's final write. */
function dropsOnce(match: string): TransactionDriver {
  let dropped = false;
  return { transaction: (work) => db.driver.transaction((sql) => work({ query: (text, params) => {
    if (!dropped && text.includes(match)) { dropped = true; throw new Error('Connection terminated unexpectedly'); }
    return sql.query(text, params);
  } })) };
}
const conversations = async (run: string) => (await db.owner.query<{ id: string; status: string; attempt: number; last_error: string | null; inconclusive_reason: string | null; finished_at: Date | null; sandbox_tenant: string }>('SELECT * FROM nazir.conversations WHERE run_id=$1 ORDER BY created_at,id', [run])).rows;
const runStatus = async (run: string) => (await db.owner.query<{ status: string; finished_at: Date | null }>('SELECT status,finished_at FROM nazir.runs WHERE id=$1', [run])).rows[0]!;
/** No heartbeat past the lease bound: what a killed request leaves behind. */
const expire = (run: string) => db.owner.query("UPDATE nazir.conversations SET lease_expires_at=now()-interval '1 second' WHERE run_id=$1 AND status='running'", [run]);
/** A request that claimed a conversation and was then killed at its time limit, before writing anything. */
const killedClaim = (run: string) => db.driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_worker'); return (await sql.query('SELECT * FROM nazir.runner_claim($1,60,$2)', ['killed_step', run])).rows[0]; });

beforeAll(async () => { db = await testDatabase(); });
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  f = await fixture(db, 'survive_' + crypto.randomUUID());
  owner = await db.createMember(f.workspaceId, ['service_owner'], 'Owner');
  reviewer = await db.createMember(f.workspaceId, ['quality_reviewer'], 'Reviewer');
  supplier = await db.createMember(f.workspaceId, ['supplier_maintainer'], 'Supplier');
  viewer = await db.createMember(f.workspaceId, ['viewer'], 'Viewer');
});

it('retries a step once after the database drops mid step, on a fresh tenant', async () => {
  const run = await enqueue();
  await expect(stepRun(db.driver, reviewer, run.id, deps({}, () => dropsOnce('INSERT INTO nazir.conversation_messages')), ready)).rejects.toThrow('Connection terminated');
  const [stuck] = await conversations(run.id);
  expect(stuck).toMatchObject({ status: 'running', attempt: 1 });
  // Before the lease runs out the step is still considered alive, and nothing is taken from it.
  expect(await recoverStale(db.driver, f.workspaceId, run.id)).toEqual({ requeued: 0, ended: 0 });
  await expect(stepRun(db.driver, reviewer, run.id, deps(), ready)).resolves.toMatchObject({ done: false, waiting: 1 });
  await expire(run.id);
  const p = await stepRun(db.driver, reviewer, run.id, deps(), ready);
  expect(p).toMatchObject({ done: true, passed: 1, waiting: 0, notes: [] });
  const [after] = await conversations(run.id);
  expect(after).toMatchObject({ status: 'passed', attempt: 2 });
  expect(after!.sandbox_tenant).not.toBe(stuck!.sandbox_tenant);
  expect((await runStatus(run.id)).status).toBe('passed');
  const actions = (await db.owner.query<{ action: string; payload: { reason?: string } }>("SELECT action,payload FROM nazir.audit_events WHERE target_id=$1 ORDER BY seq", [after!.id])).rows;
  expect(actions.find((a) => a.action === 'conversation_retried')!.payload.reason).toBe('step_stalled');
  expect(verifyAuditChain(await db.worker(f.workspaceId, (sql) => readAuditChain(sql, f.workspaceId))).ok).toBe(true);
});

it('ends a step that stalls twice as inconclusive, finishes the run, and never reruns a finished case', async () => {
  const run = await enqueue(2);
  expect(await stepRun(db.driver, reviewer, run.id, deps(), ready)).toMatchObject({ done: false, waiting: 1 });
  const [first] = await conversations(run.id);
  expect(first).toMatchObject({ status: 'passed', attempt: 1 });
  const firstMessages = (await db.owner.query('SELECT count(*)::int n FROM nazir.conversation_messages WHERE conversation_id=$1', [first!.id])).rows[0];
  // The request is killed at its time limit after claiming the second case.
  await killedClaim(run.id);
  await expire(run.id);
  // Retried once: the database then drops in the middle of that retry.
  await expect(stepRun(db.driver, reviewer, run.id, deps({}, () => dropsOnce('INSERT INTO nazir.conversation_messages')), ready)).rejects.toThrow('Connection terminated');
  expect((await conversations(run.id))[1]).toMatchObject({ status: 'running', attempt: 2, last_error: 'step_stalled' });
  await expire(run.id);
  let called = false;
  const p = await stepRun(db.driver, reviewer, run.id, { ...deps(), run: async () => { called = true; } }, ready);
  expect(called).toBe(false);
  expect(p).toMatchObject({ done: true, status: 'inconclusive', passed: 0, inconclusive: 1, waiting: 0 });
  expect(p.notes).toEqual([{ code: 'step_stalled', ...errorLines.step_stalled }]);
  const [one, two] = await conversations(run.id);
  expect(two).toMatchObject({ status: 'inconclusive', inconclusive_reason: 'step_stalled', attempt: 2 });
  expect(one).toMatchObject({ status: 'passed', attempt: 1, finished_at: first!.finished_at });
  expect((await db.owner.query('SELECT count(*)::int n FROM nazir.conversation_messages WHERE conversation_id=$1', [one!.id])).rows[0]).toEqual(firstMessages);
  expect(await runStatus(run.id)).toMatchObject({ status: 'inconclusive', finished_at: expect.any(Date) });
  expect((await db.owner.query("SELECT count(*)::int n FROM nazir.runs WHERE id=$1 AND status='running'", [run.id])).rows[0]).toEqual({ n: 0 });
  expect(verifyAuditChain(await db.worker(f.workspaceId, (sql) => readAuditChain(sql, f.workspaceId))).ok).toBe(true);
});

it('ends a stalled step at once when it has no attempts left', async () => {
  const run = await enqueue();
  await db.owner.query('UPDATE nazir.conversations SET max_attempts=1 WHERE run_id=$1', [run.id]);
  await killedClaim(run.id);
  await expire(run.id);
  expect(await recoverStale(db.driver, f.workspaceId, run.id)).toEqual({ requeued: 0, ended: 1 });
  expect((await runStatus(run.id)).status).toBe('inconclusive');
});

it('a step that hits its time limit is retried and says so in plain words', async () => {
  const run = await enqueue();
  const hangs: ChatModel = () => new Promise(() => {});
  const p = await stepRun(db.driver, reviewer, run.id, deps({ chatModelFactory: () => hangs, conversationTimeoutMs: 50 }), ready);
  expect(p).toMatchObject({ done: false, waiting: 1, notes: [{ code: 'timeout', en: errorLines.timeout.en, ar: errorLines.timeout.ar }] });
  expect((await conversations(run.id))[0]).toMatchObject({ status: 'queued', last_error: 'timeout' });
});

it('explains all providers down and the daily model cap where the run status is shown', async () => {
  let clock = Date.now();
  const chain = (env: Record<string, string>) => createAiChain({ store: memoryAiStore(() => clock), env, now: () => clock, sleep: async (ms) => { clock += ms; }, fetch: async () => new Response('', { status: 503 }) });
  const down = await enqueue();
  const a = await stepRun(db.driver, reviewer, down.id, deps({ chatModelFactory: (ctx) => chainChatModel(chain({}), { task: 'test_run', ...ctx }) }), ready);
  expect(a.notes).toEqual([{ code: 'provider_exhausted', ...errorLines.provider_exhausted }]);
  const capped = await enqueue();
  const b = await stepRun(db.driver, reviewer, capped.id, deps({ chatModelFactory: (ctx) => chainChatModel(chain({ AI_DAILY_CAP_TEST_RUN: '0' }), { task: 'test_run', ...ctx }) }), ready);
  expect(b).toMatchObject({ done: true, status: 'inconclusive', notes: [{ code: 'daily_cap', ...errorLines.daily_cap }] });
});

it('maps every run reason to one plain line in both languages, with no dashes', () => {
  expect(runReasonLine('external_unreachable')).toEqual({ code: 'agent_unreachable', ...errorLines.agent_unreachable });
  expect(runReasonLine('external_timeout')?.code).toBe('agent_unreachable');
  expect(runReasonLine('lease_expired')?.code).toBe('step_stalled');
  expect(runReasonLine('budget_reached')).toBeNull();
  expect(runReasonLine(null)).toBeNull();
  expect(runNotes([{ status: 'inconclusive', inconclusive_reason: 'daily_cap' }, { status: 'inconclusive', inconclusive_reason: 'daily_cap' }, { status: 'queued', last_error: 'provider_exhausted' }, { status: 'passed', last_error: 'timeout' }]).map((n) => n.code)).toEqual(['daily_cap', 'provider_exhausted']);
  for (const code of ['daily_cap', 'provider_exhausted', 'agent_unreachable', 'timeout', 'step_stalled', 'daily_run_cap', 'not_cancellable'] as const) {
    expect(hasDash(errorLines[code].en) || hasDash(errorLines[code].ar)).toBe(false);
    expect(errorLines[code].ar).toMatch(/[؀-ۿ]/);
  }
});

it('lets an owner or quality reviewer cancel a proposed or approved plan, once, with an audit entry', async () => {
  const proposed = (await db.owner.query<{ id: string }>("INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type) SELECT workspace_id,'Proposed',agent_version_id,rule_pack_version_id,families,languages,1,10,'{}','nazir' FROM nazir.plans WHERE id=$1 RETURNING id", [f.planId])).rows[0]!.id;
  for (const member of [supplier, viewer]) await expect(cancelPlan(db.driver, member, proposed)).rejects.toMatchObject({ name: 'Forbidden' });
  expect(await cancelPlan(db.driver, reviewer, proposed)).toMatchObject({ id: proposed, status: 'cancelled', changed: true, runs: [] });
  expect(await cancelPlan(db.driver, owner, proposed)).toMatchObject({ status: 'cancelled', changed: false });
  const audit = (await db.owner.query<{ actor_member_id: string; payload: unknown }>("SELECT actor_member_id,payload FROM nazir.audit_events WHERE action='plan.cancelled' AND target_id=$1", [proposed])).rows;
  expect(audit).toEqual([{ actor_member_id: reviewer, payload: { from: 'proposed' } }]);
  // Cancelling the approved plan also cancels its queued run, and nothing new can start from it.
  const run = await enqueue();
  expect(await cancelPlan(db.driver, owner, f.planId)).toMatchObject({ changed: true, runs: [run.id] });
  expect((await runStatus(run.id)).status).toBe('cancelled');
  expect((await conversations(run.id)).every((c) => c.status === 'cancelled')).toBe(true);
  await expect(enqueue()).rejects.toThrow('Approved plan required');
  const rejected = (await db.owner.query<{ id: string }>("INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type,status) SELECT workspace_id,'Rejected',agent_version_id,rule_pack_version_id,families,languages,1,10,'{}','nazir','rejected' FROM nazir.plans WHERE id=$1 RETURNING id", [f.planId])).rows[0]!.id;
  await expect(cancelPlan(db.driver, owner, rejected)).rejects.toMatchObject({ status: 409, code: 'not_cancellable' });
  await expect(cancelPlan(db.driver, owner, crypto.randomUUID())).rejects.toMatchObject({ name: 'NotFound' });
  expect(verifyAuditChain(await db.worker(f.workspaceId, (sql) => readAuditChain(sql, f.workspaceId))).ok).toBe(true);
});

it('lets an owner or quality reviewer cancel a queued or running run, idempotently', async () => {
  const queued = await enqueue();
  await expect(cancelRunAsMember(db.driver, supplier, queued.id)).rejects.toMatchObject({ name: 'Forbidden' });
  expect(await cancelRunAsMember(db.driver, owner, queued.id)).toEqual({ id: queued.id, status: 'cancelled', changed: true });
  expect(await cancelRunAsMember(db.driver, reviewer, queued.id)).toEqual({ id: queued.id, status: 'cancelled', changed: false });
  const audit = (await db.owner.query<{ payload: unknown }>("SELECT payload FROM nazir.audit_events WHERE action='run_cancelled' AND target_id=$1", [queued.id])).rows;
  expect(audit).toEqual([{ payload: { cancelled_by: owner } }]);
  // A running step loses its fence: its late result is not written over the cancellation.
  const running = await enqueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const step = runNextConversation({ driver: db.driver, inspectionDriver: db.driver, runId: running.id, workerId: 'live_test', chatModelFactory: () => journey(), evaluate: async () => { await gate; return passed(); } });
  for (let i = 0; i < 100 && (await conversations(running.id))[0]!.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 10));
  expect((await runStatus(running.id)).status).toBe('running');
  expect(await cancelRunAsMember(db.driver, reviewer, running.id)).toMatchObject({ changed: true });
  release();
  expect(await step).toMatchObject({ lost: true });
  expect((await conversations(running.id))[0]!.status).toBe('cancelled');
  // A finished run cannot be cancelled.
  const done = await enqueue();
  await stepRun(db.driver, owner, done.id, deps(), ready);
  expect((await runStatus(done.id)).status).toBe('passed');
  await expect(cancelRunAsMember(db.driver, owner, done.id)).rejects.toMatchObject({ status: 409, code: 'not_cancellable' });
  await expect(cancelRunAsMember(db.driver, owner, 'not-a-run')).rejects.toMatchObject({ name: 'ZodError' });
  // Another workspace's run is not found.
  const other = await fixture(db, 'survive_other_' + crypto.randomUUID());
  const foreign = await enqueue(1, undefined, crypto.randomUUID(), other);
  await expect(cancelRunAsMember(db.driver, owner, foreign.id)).rejects.toMatchObject({ name: 'NotFound' });
});

it('caps runs per person per day across workspaces, with a coded error, and leaves scripts and the demo reset alone', async () => {
  const second = await fixture(db, 'survive_second_' + crypto.randomUUID());
  const userId = (await db.owner.query<{ user_id: string }>('SELECT user_id FROM nazir.members WHERE id=$1', [owner])).rows[0]!.user_id;
  const elsewhere = (await db.owner.query<{ id: string }>("INSERT INTO nazir.members(workspace_id,user_id,display_name) VALUES($1,$2,'Owner') RETURNING id", [second.workspaceId, userId])).rows[0]!.id;
  await db.owner.query("INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES($1,$2,'service_owner')", [second.workspaceId, elsewhere]);
  const here = await runStarter(db.driver, owner);
  const there = await runStarter(db.driver, elsewhere);
  expect(here.userId).toBe(userId);
  expect(new Set(here.members.map((m) => m.workspaceId))).toEqual(new Set([f.workspaceId, second.workspaceId]));
  const keys: string[] = [];
  for (let i = 0; i < 6; i++) { const key = crypto.randomUUID(); keys.push(key); await enqueue(1, here, key); }
  for (let i = 0; i < maxRunsPerUserPerDay - 6; i++) await enqueue(1, there, crypto.randomUUID(), second);
  const refused = await enqueue(1, here).catch((error: unknown) => error);
  expect(refused).toMatchObject({ status: 429, code: 'daily_run_cap' });
  expect(mapError(refused, 'ar')).toEqual({ status: 429, body: { error: { code: 'daily_run_cap', message: errorLines.daily_run_cap.ar } } });
  await expect(enqueue(1, there, crypto.randomUUID(), second)).rejects.toMatchObject({ code: 'daily_run_cap' });
  await expect(db.worker(f.workspaceId, (sql) => assertRunCap(sql, here))).rejects.toMatchObject({ code: 'daily_run_cap' });
  // The same start again returns the same run rather than counting or refusing.
  const again = await enqueue(1, here, keys[0]);
  expect(again.id).toBeTruthy();
  // Another person is not affected, nor are runs queued without a person (scripts, fixtures).
  await expect(enqueue(1, await runStarter(db.driver, reviewer))).resolves.toHaveProperty('id');
  await expect(enqueue()).resolves.toHaveProperty('id');
  // The scheduled demo reset does not start runs and is not refused.
  await expect(resetDemosDue(db.driver)).resolves.toBeInstanceOf(Array);
  const counted = (await db.owner.query<{ n: number }>("SELECT count(*)::int n FROM nazir.audit_events WHERE action='run_enqueued' AND payload->>'started_by' = ANY($1::text[])", [[owner, elsewhere]])).rows[0]!.n;
  expect(counted).toBe(maxRunsPerUserPerDay);
});
