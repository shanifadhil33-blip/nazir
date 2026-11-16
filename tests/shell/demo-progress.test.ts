import { afterAll, beforeAll, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { testDatabase, seed, type TestDatabase } from '../helpers/pglite';
import { readDemoProgress, recordDemoView } from '../../src/server/shell/demo-progress';
let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); }, 60000);
afterAll(async () => { await db?.close(); });
it('points the guide at a planted wrong answer instead of a newer visitor check, within its workspace', async () => {
  const a = await seed(db, 'guide_target');
  const other = await seed(db, 'guide_other');
  const sample = async (workspace: typeof a, at: string) => {
    const body = (await db.owner.query<{ body: Record<string, unknown> }>('SELECT body FROM nazir.reports WHERE id=$1', [workspace.ids.reports])).rows[0]!.body;
    const runId = await workspace.insert('runs', { plan_id: workspace.ids.plans, agent_version_id: workspace.ids.agent_versions, rule_pack_version_id: workspace.ids.rule_pack_versions, frozen_manifest: {}, runner_version: '1' });
    return workspace.insert('reports', { run_id: runId, created_by: workspace.member_id, created_at: at, body: { ...body, sample: true, findings: [{ id: workspace.ids.findings }] }, supplier_body: body, viewer_body: body });
  };
  const target = await sample(a, '2025-01-01');
  await sample(other, '2025-01-02');
  expect((await readDemoProgress(db.driver, a.member_id)).checkId).toBe(target);
});
it('keeps validated guide milestones on the server, isolated and idempotent, and starts over after reset', async () => {
  const a = await seed(db, 'guide_a'); const b = await seed(db, 'guide_b');
  const read = () => readDemoProgress(db.driver, a.member_id);
  const audit = (action: string, target: string, payload = {}) => db.member(a.member_id, (sql) => sql.query("SELECT nazir.append_audit($1,'proposal',$2,$3::jsonb)", [action, target, JSON.stringify(payload)]));
  expect((await read()).step).toBe(0);
  await expect(recordDemoView(db.driver, a.member_id, { view: 'check', id: b.ids.reports })).rejects.toThrow();
  await recordDemoView(db.driver, a.member_id, { view: 'check', id: a.ids.reports });
  await recordDemoView(db.driver, a.member_id, { view: 'check', id: a.ids.reports });
  expect((await read()).step).toBe(1);
  expect((await db.owner.query("SELECT count(*)::int AS n FROM nazir.audit_events WHERE workspace_id=$1 AND action='demo.check_opened'", [a.workspace_id])).rows[0]!.n).toBe(1);
  await audit('proposal.create', a.ids.proposals!); expect((await read()).step).toBe(2);
  await audit('proposal.decide', a.ids.proposals!, { decision: 'approve' }); expect((await read()).step).toBe(3);
  await expect(recordDemoView(db.driver, a.member_id, { view: 'after', id: a.ids.proposals })).rejects.toThrow();
  // Only a completed test of an approved fix unlocks the final view marker.
  await db.owner.query("UPDATE nazir.proposals SET status='approved',retest_run_id=$2 WHERE id=$1", [a.ids.proposals, a.ids.runs]);
  await expect(recordDemoView(db.driver, a.member_id, { view: 'after', id: a.ids.proposals })).rejects.toThrow();
  await db.owner.query("UPDATE nazir.runs SET status='queued' WHERE id=$1", [a.ids.runs]);
  await db.owner.query("UPDATE nazir.runs SET status='running',started_at=now() WHERE id=$1", [a.ids.runs]);
  await db.owner.query("UPDATE nazir.runs SET status='passed',finished_at=now() WHERE id=$1", [a.ids.runs]);
  await recordDemoView(db.driver, a.member_id, { view: 'after', id: a.ids.proposals });
  expect(await read()).toEqual({ step: 4, fixId: a.ids.proposals, checkId: null });
  expect((await readDemoProgress(db.driver, b.member_id)).step).toBe(0);
  await audit('demo.history_seeded', a.workspace_id);
  expect((await read()).step).toBe(0);
  await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [b.workspace_id]);
  await expect(readDemoProgress(db.driver, b.member_id)).rejects.toThrow();
});
