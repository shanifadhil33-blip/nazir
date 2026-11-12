import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { sessionHash } from '../../src/server/auth/adapter';
import { demoWorkspaceId } from '../../src/server/auth/demo';
import { listReports, readFullReport } from '../../src/server/reports/read';
import { installDemoLibrary } from '../../src/server/demo/library';
import { assembleReport, caseResults, type ReportBody } from '../../src/server/reports/build';

let db: TestDatabase;
const member = { owner: 'd0000000-0000-4000-8000-000000000011', editor: 'd0000000-0000-4000-8000-000000000012', viewer: 'd0000000-0000-4000-8000-000000000013', supplier: 'd0000000-0000-4000-8000-000000000014' };
beforeAll(async () => { db = await testDatabase(); expect(await count('runs')).toBe(0); expect((await db.owner.query<{ ok: boolean }>('SELECT nazir.demo_seed() AS ok')).rows[0]!.ok, 'no seed before the library is there').toBe(false); await installDemoLibrary(db.driver, db.driver); expect((await db.owner.query<{ ok: boolean }>('SELECT nazir.demo_seed() AS ok')).rows[0]!.ok).toBe(true); }, 60000);
afterAll(async () => { await db?.close(); });
const count = async (table: string) => Number((await db.owner.query<{ n: string }>(`SELECT count(*) AS n FROM nazir.${table} WHERE workspace_id=$1`, [demoWorkspaceId])).rows[0]!.n);

it('fills the demo workspace with two finished checks, findings and two fixes when the seed runs', async () => {
  expect(await count('runs')).toBe(2);
  expect(await count('reports')).toBe(2);
  expect(await count('conversations')).toBe(16);
  expect(await count('findings')).toBe(5);
  expect(await count('proposals')).toBe(2);
  const statuses = (await db.owner.query<{ status: string }>('SELECT status FROM nazir.proposals WHERE workspace_id=$1 ORDER BY created_at', [demoWorkspaceId])).rows.map((r) => r.status);
  expect(statuses).toEqual(['approved', 'proposed']);
});

it('every role sees the saved checks, newest first, as independent labelled samples', async () => {
  for (const [role, id] of Object.entries(member)) {
    const { reports } = await listReports(db.driver, id);
    expect(reports, role).toHaveLength(2);
    const [latest, first] = reports.map((r) => r.body as ReportBody);
    expect(first!.sample).toBe(true);
    expect(latest!.sample).toBe(true);
    expect(first!.counts).toMatchObject({ conversations: 8, passed: 5, failed: 3, findings: 3 });
    expect(latest!.counts).toMatchObject({ conversations: 8, passed: 6, failed: 2, findings: 2 });
    expect(caseResults(latest!.conversations).filter((c) => c.status === 'failed')).toHaveLength(2);
  }
});

it('the stored copy matches what the report route would build from the same rows', async () => {
  const { reports } = await listReports(db.driver, member.owner);
  for (const report of reports) {
    const stored = await readFullReport(db.driver, member.owner, report.id);
    const rows = await db.owner.query<{ id: string; status: string; language: string; scenario_id: string; attempt_number: number }>('SELECT id,status,language,scenario_id,attempt_number FROM nazir.conversations WHERE run_id=$1 ORDER BY created_at,id', [report.run_id]);
    const rebuilt = assembleReport({ run: stored.run, conversations: rows.rows.map((r) => ({ ...r, split: 'development', inconclusive_reason: null })), findings: stored.findings, messages: stored.messages });
    expect(stored.counts).toEqual(rebuilt.counts);
    expect(stored.sentences).toEqual(rebuilt.sentences);
    expect(stored.cases).toEqual(rebuilt.cases);
  }
});

it('points at the real approved tests and planted versions, and leaves every other workspace alone', async () => {
  const rows = (await db.owner.query<{ n: string }>("SELECT count(DISTINCT c.scenario_id) AS n FROM nazir.conversations c JOIN nazir.scenarios s ON s.id=c.scenario_id WHERE s.status='approved' AND s.library_hash IS NOT NULL")).rows;
  expect(Number(rows[0]!.n)).toBe(8);
  const latest = (await db.owner.query<{ r: string }>("SELECT config->>'registry_id' AS r FROM nazir.agent_versions WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1", [demoWorkspaceId])).rows[0]!.r;
  expect(latest).toBe('planted_wrong_queue');
  const others = await db.owner.query<{ n: string }>('SELECT count(*) AS n FROM nazir.runs WHERE workspace_id<>$1', [demoWorkspaceId]);
  expect(Number(others.rows[0]!.n)).toBe(0);
});

it('does not seed twice, and refills at a demo sign in once the last check is older than 3 days', async () => {
  expect((await db.owner.query<{ ok: boolean }>('SELECT nazir.demo_seed() AS ok')).rows[0]!.ok).toBe(false);
  expect(await count('reports')).toBe(2);
  // Age the saved checks by moving the clock reading, since reports cannot be edited.
  await db.owner.query('ALTER TABLE nazir.reports DISABLE TRIGGER report_frozen');
  await db.owner.query("UPDATE nazir.reports SET created_at=created_at-interval '4 days'");
  await db.owner.query('ALTER TABLE nazir.reports ENABLE TRIGGER report_frozen');
  await db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_auth');
    await sql.query("SELECT * FROM nazir.auth_demo_session('viewer',$1,now()+interval '1 hour')", [sessionHash('refill')]);
  });
  expect(await count('reports')).toBe(2);
  const { reports } = await listReports(db.driver, member.viewer);
  expect(reports).toHaveLength(2);
});

it('lists the two fixes for every role, with titles, people and times but no evidence or patch', async () => {
  const { listProposals } = await import('../../src/server/repair/list');
  for (const [role, id] of Object.entries(member)) {
    const { proposals } = await listProposals(db.driver, id);
    expect(proposals.map((p) => p.status), role).toEqual(expect.arrayContaining(['approved', 'proposed']));
    const approved = proposals.find((p) => p.status === 'approved')!;
    expect(approved).toMatchObject({ proposed_by_name: 'Bilal Nasser', decided_by_name: 'Yusuf Haddad', title: 'Restore the approved complaint routing' });
    expect(Object.keys(approved).sort()).toEqual(['created_at', 'decided_at', 'decided_by_name', 'finding_id', 'id', 'proposed_by_name', 'status', 'title', 'title_ar']);
  }
});

it('refuses the fix list to someone outside the workspace', async () => {
  const { listProposals } = await import('../../src/server/repair/list');
  const stranger = await db.bootstrap('stranger');
  const own = await listProposals(db.driver, stranger.member_id);
  expect(own.proposals).toEqual([]);
});

it('lets the reviewer approve the waiting fix like any real fix, and refuses the person who suggested it', async () => {
  const { decideRepair } = await import('../../src/server/repair/proposals');
  const waiting = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.proposals WHERE workspace_id=$1 AND status='proposed'", [demoWorkspaceId])).rows[0]!.id;
  const input = { id: waiting, decision: 'approve', reason: 'I checked the expected and actual answers.', evidence_opened: true };
  await expect(decideRepair(db.driver, member.supplier, input)).rejects.toThrow();
  await expect(decideRepair(db.driver, member.viewer, input)).rejects.toThrow();
  const done = await decideRepair(db.driver, member.editor, input);
  expect(done).toMatchObject({ status: 'approved', repeated: false });
  expect(done.retest!.retest.length).toBeGreaterThan(0);
  const { listProposals } = await import('../../src/server/repair/list');
  expect((await listProposals(db.driver, member.viewer)).proposals.find((p) => p.id === waiting)!.status).toBe('approved');
});

it('uses a different faulty version for each sample, consistently across its plan, run and answers', async () => {
  const rows = (await db.owner.query<{ registry: string; matches: boolean; failed: string[] }>(`SELECT v.config->>'registry_id' AS registry,
    bool_and(c.agent_version_id=r.agent_version_id AND p.agent_version_id=r.agent_version_id AND (f.id IS NULL OR f.agent_version_id=r.agent_version_id)) AS matches,
    array_agg(DISTINCT s.stable_key ORDER BY s.stable_key) FILTER(WHERE c.status='failed') AS failed
    FROM nazir.runs r JOIN nazir.plans p ON p.id=r.plan_id JOIN nazir.agent_versions v ON v.id=r.agent_version_id
    JOIN nazir.conversations c ON c.run_id=r.id JOIN nazir.scenarios s ON s.id=c.scenario_id
    LEFT JOIN nazir.findings f ON f.conversation_id=c.id
    WHERE r.idempotency_key LIKE 'demo-seed-%' GROUP BY r.id,v.config ORDER BY r.created_at`)).rows;
  expect(rows.map((r) => r.registry)).toEqual(['planted_wrong_queue', 'planted_false_submit']);
  expect(rows.every((r) => r.matches)).toBe(true);
  expect(rows[0]!.failed).not.toEqual(rows[1]!.failed);
  expect((await db.owner.query("SELECT id FROM nazir.findings WHERE workspace_id=$1 AND status='retest_passed'", [demoWorkspaceId])).rows).toHaveLength(0);
});

it('keeps normal deletes and updates blocked, including forged cleanup flags', async () => {
  for (const table of ['reports', 'conversation_messages', 'approvals', 'audit_events']) {
    await expect(db.owner.query(`DELETE FROM nazir.${table} WHERE workspace_id=$1`, [demoWorkspaceId])).rejects.toThrow(/cannot change|Append only/);
  }
  await expect(db.owner.query("UPDATE nazir.reports SET body=body WHERE workspace_id=$1", [demoWorkspaceId])).rejects.toThrow(/cannot change/);
  const row = (await db.owner.query('SELECT * FROM nazir.reports WHERE workspace_id=$1 LIMIT 1', [demoWorkspaceId])).rows[0]!;
  await db.member(member.owner, async (sql) => {
    await sql.query("SELECT set_config('app.demo_seed_cleanup','on',true)");
    expect((await sql.query<{ ok: boolean }>("SELECT nazir.demo_seed_delete_ok('reports',$1::jsonb) AS ok", [JSON.stringify(row)])).rows[0]!.ok).toBe(false);
  });
  await expect(db.member(member.owner, (sql) => sql.query('SELECT nazir.demo_seed_clear()'))).rejects.toThrow(/permission denied/);
  await expect(db.worker(demoWorkspaceId, (sql) => sql.query('SELECT nazir.demo_seed_rows()'))).rejects.toThrow(/permission denied/);
  await expect(db.member(member.owner, (sql) => sql.query('SELECT nazir.worker_demo_reseed($1)', [demoWorkspaceId]))).rejects.toThrow(/permission denied/);
});

it('replaces one entire seeded graph while preserving visitor checks, other workspaces and the audit chain', async () => {
  const audit = (await db.owner.query('SELECT * FROM nazir.audit_events WHERE workspace_id=$1 ORDER BY seq', [demoWorkspaceId])).rows;
  const first = (await db.owner.query<{ run: string; plan: string; conversation: string; finding: string }>(`SELECT r.id AS run,r.plan_id AS plan,c.id AS conversation,f.id AS finding
    FROM nazir.runs r JOIN nazir.conversations c ON c.run_id=r.id JOIN nazir.findings f ON f.conversation_id=c.id
    WHERE r.idempotency_key LIKE 'demo-seed-%' ORDER BY r.created_at LIMIT 1`)).rows[0]!;
  const visitorPlan = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type,proposed_by)
    SELECT workspace_id,'Visitor check',agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type,proposed_by FROM nazir.plans WHERE id=$1 RETURNING id`, [first.plan])).rows[0]!.id;
  const visitorRun = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,idempotency_key)
    SELECT workspace_id,$2,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,'visitor-started' FROM nazir.runs WHERE id=$1 RETURNING id`, [first.run, visitorPlan])).rows[0]!.id;
  await db.owner.query(`INSERT INTO nazir.finding_attempts(workspace_id,finding_id,conversation_id) VALUES($1,$2,$3)`, [demoWorkspaceId, first.finding, first.conversation]);
  await db.owner.query(`INSERT INTO nazir.tool_events(workspace_id,conversation_id,seq,tool_name,request,response,outcome) VALUES($1,$2,1,'create_case','{}','{}','ok')`, [demoWorkspaceId, first.conversation]);
  await db.owner.query(`INSERT INTO nazir.state_readings(workspace_id,conversation_id,source,reading) VALUES($1,$2,'inspection_channel','{}')`, [demoWorkspaceId, first.conversation]);
  const runs = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.runs WHERE idempotency_key LIKE 'demo-seed-%' ORDER BY created_at")).rows;
  await db.owner.query(`INSERT INTO nazir.comparisons(workspace_id,run_a_id,run_b_id,created_by,comparer_version,summary,pairs) VALUES($1,$2,$3,$4,'n17','{}','[]')`, [demoWorkspaceId, runs[0]!.id, runs[1]!.id, member.owner]);
  await expect(db.owner.query('DELETE FROM nazir.comparisons WHERE workspace_id=$1', [demoWorkspaceId])).rejects.toThrow(/cannot change/);
  // Reports are immutable in the app. Move their clock only in this local fixture.
  await db.owner.query('ALTER TABLE nazir.reports DISABLE TRIGGER report_frozen');
  await db.owner.query("UPDATE nazir.reports SET created_at=created_at-interval '4 days' WHERE workspace_id=$1", [demoWorkspaceId]);
  await db.owner.query('ALTER TABLE nazir.reports ENABLE TRIGGER report_frozen');
  expect((await db.owner.query<{ ok: boolean }>('SELECT nazir.demo_seed() AS ok')).rows[0]!.ok).toBe(true);
  expect((await db.owner.query<{ ok: boolean }>('SELECT nazir.demo_seed() AS ok')).rows[0]!.ok).toBe(false);
  expect(await count('reports')).toBe(2);
  expect(await count('conversations')).toBe(16);
  expect(await count('findings')).toBe(5);
  expect(await count('proposals')).toBe(2);
  expect(await count('approvals')).toBe(2); // The unrelated rule approval is preserved too.
  for (const table of ['tool_events', 'state_readings', 'finding_attempts', 'comparisons']) expect(await count(table), table).toBe(0);
  expect((await db.owner.query('SELECT id FROM nazir.runs WHERE id=$1', [visitorRun])).rows).toHaveLength(1);
  expect((await db.owner.query('SELECT id FROM nazir.plans WHERE id=$1', [visitorPlan])).rows).toHaveLength(1);
  expect((await db.owner.query('SELECT id FROM nazir.runs WHERE id=$1', [first.run])).rows).toHaveLength(0);
  expect((await db.owner.query('SELECT * FROM nazir.audit_events WHERE workspace_id=$1 AND seq<=$2 ORDER BY seq', [demoWorkspaceId, audit.at(-1)!.seq])).rows).toEqual(audit);
});

it('explicit reset seeds once immediately despite recent reports, and refuses a real workspace', async () => {
  const { resetDemoNow } = await import('../../src/server/demo/reset');
  const before = (await db.owner.query('SELECT id FROM nazir.reports WHERE workspace_id=$1', [demoWorkspaceId])).rows;
  await resetDemoNow(db.driver, member.owner, demoWorkspaceId);
  expect(await count('reports')).toBe(2);
  const after = (await db.owner.query('SELECT id FROM nazir.reports WHERE workspace_id=$1', [demoWorkspaceId])).rows;
  expect(after.every((row) => !before.some((old) => old.id === row.id))).toBe(true);
  await resetDemoNow(db.driver, member.owner, demoWorkspaceId);
  expect(await count('reports')).toBe(2);
  expect(await count('proposals')).toBe(2);
  await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [demoWorkspaceId]);
  try {
    expect((await db.owner.query<{ ok: boolean }>('SELECT nazir.demo_seed() AS ok')).rows[0]!.ok).toBe(false);
    await expect(resetDemoNow(db.driver, member.owner, demoWorkspaceId)).rejects.toThrow(/not a demo/);
    await expect(db.worker(demoWorkspaceId, (sql) => sql.query('SELECT nazir.worker_demo_reseed($1)', [demoWorkspaceId]))).rejects.toThrow(/not a demo/);
    expect(await count('reports')).toBe(2);
  } finally { await db.owner.query("UPDATE nazir.workspaces SET kind='demo' WHERE id=$1", [demoWorkspaceId]); }
});
