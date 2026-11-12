import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { TransactionDriver } from '../../src/server/db/driver';
const hooks = vi.hoisted(() => ({ after: [] as (() => Promise<void>)[], driver: null as TransactionDriver | null, lock: null as Parameters<typeof tick>[0]['lock'] | null, run: null as typeof runNextConversation | null }));
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => { hooks.after.push(fn); } }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: () => hooks.driver, inspectionRuntimeDriver: () => hooks.driver, runnerLock: () => hooks.lock!() }));
vi.mock('../../src/server/runner/tick', async (original) => {
  const real = await original<typeof import('../../src/server/runner/tick')>();
  return { ...real, tick: (input: Parameters<typeof real.tick>[0]) => real.tick({ ...input, ...(input.run ? {} : { run: hooks.run! }) }) };
});
import { POST } from '../../src/app/api/runner/tick/route';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { createLibraryFixture } from '../../src/server/runner/library-fixture';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { runStarter } from '../../src/server/runner/run-cap';
import { proposeBoundedPlan } from '../../src/server/planner/bound';
import { approvePlan } from '../../src/server/memory/planner';
import { runNextConversation } from '../../src/server/runner/worker';
import { pendingRuns, tick } from '../../src/server/runner/tick';
import { starterDriver } from '../../src/server/runner/context';
import { createReport } from '../../src/server/reports/read';
import { cancelRunAsMember } from '../../src/server/runner/cancel';
import { activeRuns, kickRun } from '../../src/server/runner/runs';
import { completionOf } from '../../src/server/reports/build';

let db: TestDatabase, f: Awaited<ReturnType<typeof createLibraryFixture>>;
let held = false;
const lock = async () => {
  if (held) return null;
  held = true;
  return async () => { held = false; };
};
beforeAll(async () => { db = await testDatabase(); f = await db.driver.transaction(createLibraryFixture); }, 60000);
afterAll(async () => { await db?.close(); });
afterEach(() => { hooks.after = []; vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function enqueue(trusted = true, size: 'quick' | 'full' = 'quick', ordered = false) {
  const rules = (await db.owner.query<{ rule_pack_version_id: string }>('SELECT rule_pack_version_id FROM nazir.plans WHERE id=$1', [f.planId])).rows[0]!.rule_pack_version_id;
  const version = f.versions.find((v) => v.registry_id === 'baseline')!.id;
  const plan = await proposeBoundedPlan(db.driver, f.members.author, { size, agent_version_id: version, rule_pack_version_id: rules });
  await approvePlan(db.driver, f.members.reviewer, { id: plan.id, reason: 'I reviewed these questions.', evidence_opened: true });
  return enqueueRun(db.driver, { workspaceId: f.workspaceId, planId: plan.id, agentVersionId: version, scenarioIds: plan.scenarioIds, ...(ordered ? { order: [...plan.scenarioIds].reverse() } : {}), repeats: 1, recordsOnly: true, idempotencyKey: crypto.randomUUID(), ...(trusted ? { startedBy: await runStarter(db.driver, f.members.author) } : {}) });
}
async function freshStarter() {
  f = { ...f, members: { ...f.members, author: await db.createMember(f.workspaceId, ['service_owner'], 'Fresh starter') } };
}
const fakeRun: typeof runNextConversation = (input) => runNextConversation({ ...input, chatModelFactory: () => async () => ({ content: 'I cannot do that.' }) });
const reportsFor = async (id: string) => (await db.owner.query<{ id: string; body: Parameters<typeof completionOf>[0] }>('SELECT id,body FROM nazir.reports WHERE run_id=$1', [id])).rows;

it('finishes eight questions with four overlapping model calls and one server report, without browser steps', async () => {
  const run = await enqueue();
  let active = 0, peak = 0, contention = 3;
  const modelRun: typeof runNextConversation = (input) => {
    if (contention-- > 0) return Promise.resolve(null);
    return runNextConversation({ ...input, chatModelFactory: () => async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 400));
    active--; return { content: 'I cannot do that.' };
  } });
  };
  expect(await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: modelRun })).toEqual({ busy: false, pending: false });
  expect(peak).toBe(4);
  const saved = await reportsFor(run.id);
  expect(saved).toHaveLength(1);
  expect(completionOf(saved[0]!.body)).toEqual({ complete: true, tries_done: 8, tries_total: 8 });
  const again = await Promise.all([createReport(db.driver, f.members.author, { run_id: run.id }), createReport(db.driver, f.members.author, { run_id: run.id })]);
  expect(again.map((r) => r.id)).toEqual([saved[0]!.id, saved[0]!.id]);
  expect(await reportsFor(run.id)).toHaveLength(1);
});

it('does no work in a second concurrent tick and releases the lock after the first', async () => {
  const run = await enqueue();
  let unblock!: () => void;
  let entered!: () => void;
  const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const blocked: typeof runNextConversation = async (input) => { entered(); await gate; return fakeRun(input); };
  const first = tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: blocked });
  await enteredGate;
  expect(await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: fakeRun })).toEqual({ busy: true, pending: false });
  unblock(); await first;
  expect(held).toBe(false);
  expect(await reportsFor(run.id)).toHaveLength(1);
});

it('ends a killed Quick worker at its limit and preserves completed answers', async () => {
  const run = await enqueue();
  await fakeRun({ driver: db.driver, inspectionDriver: db.driver, runId: run.id, workerId: 'finished_before_kill' });
  const first = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.conversations WHERE run_id=$1 AND status IN ('passed','failed','inconclusive')", [run.id])).rows[0]!.id;
  await db.worker(f.workspaceId, (sql) => sql.query('SELECT * FROM nazir.runner_claim($1,10,$2)', ['killed_tick', run.id]));
  await db.owner.query("UPDATE nazir.conversations SET lease_expires_at=now()-interval '1 minute' WHERE run_id=$1 AND status='running'", [run.id]);
  await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: fakeRun });
  expect((await db.owner.query('SELECT attempt FROM nazir.conversations WHERE id=$1', [first])).rows[0]!.attempt).toBe(1);
  expect((await db.owner.query('SELECT max(attempt)::int AS n FROM nazir.conversations WHERE run_id=$1', [run.id])).rows[0]!.n).toBe(1);
  expect((await db.owner.query("SELECT status,last_error,attempt FROM nazir.conversations WHERE run_id=$1 AND last_error='step_stalled'", [run.id])).rows).toEqual([{ status: 'inconclusive', last_error: 'step_stalled', attempt: 1 }]);
  expect(await reportsFor(run.id)).toHaveLength(1);
});

it('skips queued and running legacy work with no trusted starter, and restricts discovery grants', async () => {
  const run = await enqueue(false);
  await db.worker(f.workspaceId, (sql) => sql.query('SELECT * FROM nazir.runner_claim($1,30,$2)', ['legacy_worker', run.id]));
  expect((await pendingRuns(db.driver)).some((r) => r.run_id === run.id)).toBe(false);
  expect(await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: fakeRun })).toMatchObject({ pending: false });
  expect((await db.owner.query('SELECT status FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!.status).toBe('running');
  await expect(db.member(f.members.author, (sql) => sql.query('SELECT * FROM nazir.runner_pending(100)'))).rejects.toThrow(/permission denied/);
  await expect(db.worker(f.workspaceId, (sql) => sql.query('SELECT * FROM nazir.runner_pending(101)'))).rejects.toThrow(/Invalid limit/);
  const fn = (await db.owner.query<{ proconfig: string[]; app: boolean; worker: boolean; auth: boolean }>("SELECT proconfig,has_function_privilege('nazir_app',oid,'EXECUTE') AS app,has_function_privilege('nazir_worker',oid,'EXECUTE') AS worker,has_function_privilege('nazir_auth',oid,'EXECUTE') AS auth FROM pg_proc WHERE oid='nazir.runner_pending(integer)'::regprocedure")).rows[0]!;
  expect(fn).toMatchObject({ app: false, worker: true, auth: false });
  expect(fn.proconfig).toContain('search_path=pg_catalog, nazir');
  await cancelRunAsMember(db.driver, f.members.author, run.id);
});

it('revalidates starter membership and workspace on every transaction', async () => {
  const run = await enqueue();
  const other = await db.bootstrap('tick_other_workspace');
  const wrong = starterDriver(db.driver, { run_id: run.id, workspace_id: f.workspaceId, started_by: other.member_id });
  await expect(wrong.transaction((sql) => sql.query('SELECT id FROM nazir.runs'))).rejects.toThrow();
  expect((await activeRuns(db.driver, other.member_id)).runs.some((r) => r.run_id === run.id)).toBe(false);
  await expect(kickRun(db.driver, other.member_id, run.id)).rejects.toMatchObject({ name: 'NotFound' });
  const scoped = starterDriver(db.driver, { run_id: run.id, workspace_id: f.workspaceId, started_by: f.members.author });
  await scoped.transaction((sql) => sql.query('SELECT id FROM nazir.runs WHERE id=$1', [run.id]));
  await db.owner.query("UPDATE nazir.members SET status='removed' WHERE id=$1", [f.members.author]);
  await expect(scoped.transaction((sql) => sql.query('SELECT id FROM nazir.runs'))).rejects.toThrow();
  expect((await pendingRuns(db.driver)).some((r) => r.run_id === run.id)).toBe(false);
  await db.owner.query("UPDATE nazir.members SET status='active' WHERE id=$1", [f.members.author]);
  await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: fakeRun });
});

it('returns pending at its budget and finishes through a fresh tick', async () => {
  const run = await enqueue();
  let clock = 0;
  const bounded: typeof runNextConversation = async (input) => { const result = await fakeRun(input); clock = 30_000; return result; };
  expect(await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: bounded, budgetMs: 30_000, now: () => clock })).toEqual({ busy: false, pending: true });
  expect(await reportsFor(run.id)).toHaveLength(0);
  await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: fakeRun });
  expect(await reportsFor(run.id)).toHaveLength(1);
});

it('handles a stop during model work without marking cancelled questions as completed', async () => {
  const run = await enqueue();
  let stopped = false;
  const stopDuringCall: typeof runNextConversation = (input) => runNextConversation({ ...input, chatModelFactory: () => async () => {
    if (!stopped) { stopped = true; await cancelRunAsMember(db.driver, f.members.reviewer, run.id); }
    return { content: 'I cannot do that.' };
  } });
  await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: stopDuringCall });
  const saved = await reportsFor(run.id);
  expect(saved).toHaveLength(1);
  expect(saved[0]!.body.run.status).toBe('cancelled');
  expect(completionOf(saved[0]!.body)).toMatchObject({ complete: false, tries_done: 0, tries_total: 8 });
});

it('recovers interrupted report finalization without calling a model again', async () => {
  const run = await enqueue();
  for (let i = 0; i < 8; i++) await fakeRun({ driver: db.driver, inspectionDriver: db.driver, runId: run.id, workerId: 'before_report_crash' });
  expect(await reportsFor(run.id)).toHaveLength(0);
  expect((await pendingRuns(db.driver)).find((r) => r.run_id === run.id)).toEqual({ run_id: run.id, workspace_id: f.workspaceId, started_by: f.members.author });
  const neverRun: typeof runNextConversation = async () => { throw new Error('Finished answers must stay finished'); };
  await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: neverRun });
  expect(await reportsFor(run.id)).toHaveLength(1);
});
it('reduces later batches to three when a provider is exhausted', async () => {
  const run = await enqueue();
  let inFlight = 0, first = true;
  const batches: number[] = [];
  const limited: typeof runNextConversation = async (input) => {
    if (!inFlight) batches.push(0);
    inFlight++; batches[batches.length - 1] = batches[batches.length - 1]! + 1;
    try {
      const result = await fakeRun(input);
      if (first && result) { first = false; return { ...result, reason: 'provider_exhausted' }; }
      return result;
    } finally { inFlight--; }
  };
  await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: limited });
  expect(batches.slice(0, 2)).toEqual([4, 3]);
  expect(batches.slice(1).every((size) => size <= 3)).toBe(true);
  expect(await reportsFor(run.id)).toHaveLength(1);
});
it('releases exclusivity even when discovery fails', async () => {
  const broken = { transaction: async () => { throw new Error('Database unavailable'); } };
  await expect(tick({ driver: broken, inspectionDriver: db.driver, lock })).rejects.toThrow('Database unavailable');
  expect(held).toBe(false);
});


it.each(['quick', 'full'] as const)('persists %s infrastructure limits on both conversation insert paths', async (size) => {
  await freshStarter();
  for (const ordered of [false, true]) {
    const run = await enqueue(true, size, ordered);
    const rows = (await db.owner.query<{ max_attempts: number }>('SELECT max_attempts FROM nazir.conversations WHERE run_id=$1', [run.id])).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.max_attempts === (size === 'quick' ? 1 : 3))).toBe(true);
    if (size === 'quick') expect(rows).toHaveLength(8);
    await cancelRunAsMember(db.driver, f.members.author, run.id);
    await createReport(db.driver, f.members.author, { run_id: run.id });
  }
});

it.each(['quick', 'full'] as const)('a genuine %s model timeout obeys the persisted attempt limit', async (size) => {
  await freshStarter();
  const run = await enqueue(true, size);
  const timed = await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, runId: run.id, workerId: 'timeout_limit', conversationTimeoutMs: 60, chatModelFactory: () => () => new Promise(() => {}) });
  expect(timed).toMatchObject({ attempt: 1, status: size === 'quick' ? 'inconclusive' : 'queued', reason: 'timeout' });
  const row = (await db.owner.query<{ id: string; attempt: number; max_attempts: number; last_error: string }>('SELECT id,attempt,max_attempts,last_error FROM nazir.conversations WHERE id=$1', [timed!.conversation_id])).rows[0]!;
  expect(row).toMatchObject({ attempt: 1, max_attempts: size === 'quick' ? 1 : 3, last_error: 'timeout' });
  if (size === 'full') {
    // Keep this timed-out question first so the next claim proves an actual retry.
    await db.owner.query("UPDATE nazir.conversations SET available_at=now()-interval '1 second',created_at=now()-interval '1 day' WHERE id=$1", [row.id]);
    expect(await fakeRun({ driver: db.driver, inspectionDriver: db.driver, runId: run.id, workerId: 'after_timeout' })).toMatchObject({ conversation_id: row.id, attempt: 2 });
  } else {
    await tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: fakeRun });
    expect((await db.owner.query('SELECT attempt,status FROM nazir.conversations WHERE id=$1', [row.id])).rows[0]).toEqual({ attempt: 1, status: 'inconclusive' });
  }
  await cancelRunAsMember(db.driver, f.members.author, run.id).catch(() => {});
  await createReport(db.driver, f.members.author, { run_id: run.id });
});

it('Stop then Start survives an older lock holder through the authenticated server chain, without a browser kick', async () => {
  await freshStarter();
  const old = await enqueue();
  let entered!: () => void, release!: () => void, clock = 0;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const blocked: typeof runNextConversation = async () => { entered(); await gate; clock = 30_000; return null; };
  const previous = tick({ driver: db.driver, inspectionDriver: db.driver, lock, run: blocked, budgetMs: 30_000, now: () => clock });
  await ready;
  await cancelRunAsMember(db.driver, f.members.reviewer, old.id);
  const next = await enqueue();
  expect((await activeRuns(db.driver, f.members.author)).runs.map((r) => r.run_id)).toContain(next.id);
  hooks.driver = db.driver; hooks.lock = lock; hooks.run = fakeRun;
  vi.stubEnv('CRON_SECRET', 'test_tick_secret'); vi.stubEnv('AUTH_URL', 'https://example.test');
  const request = () => new Request('https://example.test/api/runner/tick', { method: 'POST', headers: { authorization: 'Bearer test_tick_secret' } });
  const fetcher = vi.fn(async () => POST(request()));
  vi.stubGlobal('fetch', fetcher);
  expect((await POST(request())).status).toBe(202);
  await hooks.after.shift()!(); // Start's tick is busy and must leave another callback.
  expect(hooks.after).toHaveLength(1);
  expect(await reportsFor(next.id)).toHaveLength(0);
  release(); await previous;
  await hooks.after.shift()!(); // The delayed authenticated fetch schedules work after its response.
  expect(fetcher).toHaveBeenCalledTimes(1);
  await hooks.after.shift()!();
  expect(await reportsFor(next.id)).toHaveLength(1);
  expect(completionOf((await reportsFor(next.id))[0]!.body).complete).toBe(true);
  expect(hooks.after).toHaveLength(0);
});
