import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDemoCleanup, parseArgs } from '../../scripts/demo-cleanup.mjs';
import { countStale, qaGoalPattern, selectStale, staleAfterMs, type PlanRow, type RunRow } from '../../src/server/demo/stale';
import * as stale from '../../src/server/demo/stale';
import { resetDemoNow, resetDemosDue } from '../../src/server/demo/reset';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';

const now = new Date('2026-11-03T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const hour = staleAfterMs;

describe('selectStale', () => {
  const plans: PlanRow[] = [
    { id: 'p1', goal: 'Check the complaint flow before the demo', status: 'approved', created_at: ago(5 * hour) },
    { id: 'p2', goal: 'Check refunds', status: 'cancelled', created_at: ago(2 * hour) },
    { id: 'p3', goal: 'QA smoke check', status: 'proposed', created_at: ago(2 * hour) },
    { id: 'p4', goal: 'Check refunds again', status: 'proposed', created_at: ago(1000) },
    { id: 'p5', goal: '  [test] checkout', status: 'approved', created_at: ago(hour / 2) },
  ];
  const runs: RunRow[] = [
    { id: 'r1', plan_id: 'p1', status: 'running', created_at: ago(2 * hour) },
    { id: 'r2', plan_id: 'p1', status: 'queued', created_at: ago(hour + 1000) },
    { id: 'r3', plan_id: 'p1', status: 'queued', created_at: ago(hour - 1000) },
    { id: 'r4', plan_id: 'p1', status: 'passed', created_at: ago(9 * hour) },
    { id: 'r5', plan_id: 'p2', status: 'cancelled', created_at: ago(3 * hour) },
    { id: 'r6', plan_id: 'p5', status: 'failed', created_at: ago(hour / 2) },
    { id: 'boundary', plan_id: 'p1', status: 'running', created_at: ago(hour) },
    { id: 'r7', plan_id: 'p1', status: 'planned', created_at: ago(3 * hour) },
  ];
  it('picks stuck runs older than an hour and never finished ones', () => {
    const picked = selectStale({ plans, runs, now });
    expect(picked.stuckRunIds).toEqual(['r1', 'r2', 'r7']);
    expect(picked.cancelledRunIds).toEqual(['r5']);
    expect(picked.cancelledPlanIds).toEqual(['p2']);
  });
  it('reports old proposed plans and QA leftovers without selecting them for change', () => {
    const picked = selectStale({ plans, runs, now });
    expect(picked.staleProposedPlanIds).toEqual(['p3']);
    expect(picked.qaPlanIds).toEqual(['p3', 'p5']);
    expect(picked.qaRunIds).toEqual(['r6']);
    expect(countStale(picked)).toMatchObject({ stuckRunIds: 3, qaPlanIds: 2, qaRunIds: 1 });
  });
  it('is deterministic and handles dates and bad input', () => {
    const shuffled = selectStale({ plans: [...plans].reverse(), runs: [...runs].reverse(), now });
    expect(shuffled).toEqual(selectStale({ plans, runs, now }));
    const asDate = selectStale({ plans: [], runs: [{ id: 'x', plan_id: 'p', status: 'running', created_at: new Date(now.getTime() - 2 * hour) }], now });
    expect(asDate.stuckRunIds).toEqual(['x']);
    expect(selectStale({ plans: [], runs: [{ id: 'y', plan_id: 'p', status: 'running', created_at: 'not a date' }], now }).stuckRunIds).toEqual([]);
  });
  it.each(['QA run', 'qa: check', '[QA] x', 'Test the refund', 'smoke', 'Live check 2', 'dummy plan'])('marks %s as a QA goal', (goal) => {
    expect(qaGoalPattern.test(goal)).toBe(true);
  });
  it.each(['Check the complaint flow', 'Quality review of refunds', 'Contest rules', 'Attestation check'])('does not mark %s', (goal) => {
    expect(qaGoalPattern.test(goal)).toBe(false);
  });
});

describe('parseArgs', () => {
  it('defaults to a dry run and validates input', () => {
    expect(parseArgs([])).toEqual({ apply: false, workspace: null });
    expect(parseArgs(['--apply'])).toEqual({ apply: true, workspace: null });
    expect(() => parseArgs(['--workspace', 'nope'])).toThrow(/UUID/);
    expect(() => parseArgs(['--wipe'])).toThrow(/Unknown option/);
  });
});

describe('demo cleanup against a local database', () => {
  let db: TestDatabase;
  let demo: Awaited<ReturnType<typeof seed>>;
  let real: Awaited<ReturnType<typeof seed>>;
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  async function stuckRun(w: Awaited<ReturnType<typeof seed>>, status: string, age: string) {
    const run = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,created_at)
      VALUES($1,$2,$3,$4,'{}','1',$5,now()-($6::interval)) RETURNING id`, [w.workspace_id, w.ids.plans, w.ids.agent_versions, w.ids.rule_pack_versions, status, age])).rows[0]!.id;
    const conversation = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status) VALUES($1,$2,$3,'en',$4,$5) RETURNING id`, [w.workspace_id, run, w.ids.scenarios, `k-${run}`, status])).rows[0]!.id;
    return { run, conversation };
  }
  const statusOf = async (table: 'runs' | 'conversations', id: string) => (await db.owner.query<{ status: string }>(`SELECT status FROM nazir.${table} WHERE id=$1`, [id])).rows[0]!.status;
  let demoOld: { run: string; conversation: string };
  let demoFresh: { run: string; conversation: string };
  let realOld: { run: string; conversation: string };

  beforeAll(async () => {
    db = await testDatabase();
    demo = await seed(db, 'Tariq');
    real = await seed(db, 'Faisal');
    await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [real.workspace_id]);
    demoOld = await stuckRun(demo, 'running', '3 hours');
    demoFresh = await stuckRun(demo, 'queued', '30 minutes');
    realOld = await stuckRun(real, 'running', '1 hour');
  }, 60000);
  afterAll(async () => { await db?.close(); });

  it('dry run prints counts only and changes nothing', async () => {
    const total = await runDemoCleanup(db.driver, stale, { now: new Date() }, log);
    expect(total).toMatchObject({ stuckRunIds: 1, qaPlanIds: 1, cancelledNow: 0 });
    expect(lines.join('\n')).toContain('DRY RUN');
    expect(lines.join('\n')).not.toContain(demoOld.run);
    expect(lines.join('\n')).not.toContain('Tariq');
    expect(await statusOf('runs', demoOld.run)).toBe('running');
  });
  it('refuses a real workspace', async () => {
    await expect(runDemoCleanup(db.driver, stale, { workspace: real.workspace_id }, log)).rejects.toThrow(/not a demo/);
    expect(await statusOf('runs', realOld.run)).toBe('running');
  });
  it('the demo helper itself refuses to cancel real runs, even when handed their ids', async () => {
    expect(await db.worker(real.workspace_id, (sql) => stale.closeStuckRuns(sql))).toBe(0);
    expect(await db.worker(real.workspace_id, (sql) => stale.cancelStuckRuns(sql, [realOld.run]))).toBe(0);
    expect(await statusOf('runs', realOld.run)).toBe('running');
  });
  it('apply cancels only stuck demo runs and is safe to run twice', async () => {
    const first = await runDemoCleanup(db.driver, stale, { apply: true }, log);
    expect(first.cancelledNow).toBe(1);
    expect(await statusOf('runs', demoOld.run)).toBe('cancelled');
    expect(await statusOf('conversations', demoOld.conversation)).toBe('cancelled');
    expect(await statusOf('runs', demoFresh.run)).toBe('queued');
    expect(await statusOf('runs', realOld.run)).toBe('running');
    expect(await statusOf('conversations', realOld.conversation)).toBe('running');
    const second = await runDemoCleanup(db.driver, stale, { apply: true }, log);
    expect(second.cancelledNow).toBe(0);
    const audit = (await db.owner.query<{ n: number }>("SELECT count(*)::int n FROM nazir.audit_events WHERE action='run_cancelled' AND target_id=$1", [demoOld.run])).rows[0]!.n;
    expect(audit).toBe(1);
  });
  it('the demo reset also closes runs stuck for over an hour, and twice is the same as once', async () => {
    const again = await stuckRun(demo, 'running', '2 hours');
    const owner = demo.member_id;
    const result = await resetDemoNow(db.driver, owner, demo.workspace_id);
    expect(result.stuckRunsCancelled).toBe(1);
    expect(await statusOf('runs', again.run)).toBe('cancelled');
    expect((await resetDemoNow(db.driver, owner, demo.workspace_id)).stuckRunsCancelled).toBe(0);
    const stuckScheduled = await stuckRun(demo, 'queued', '2 hours');
    const scheduled = (await resetDemosDue(db.driver)).find((row) => row.workspaceId === demo.workspace_id)!;
    expect(scheduled.stuckRunsCancelled).toBe(1);
    expect(await statusOf('runs', stuckScheduled.run)).toBe('cancelled');
    expect(await statusOf('runs', demoFresh.run)).toBe('queued');
    expect(await statusOf('runs', realOld.run)).toBe('running');
  });
});
