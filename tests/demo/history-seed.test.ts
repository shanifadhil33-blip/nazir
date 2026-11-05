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

it('every role sees the saved checks, newest first, with the second check better than the first', async () => {
  for (const [role, id] of Object.entries(member)) {
    const { reports } = await listReports(db.driver, id);
    expect(reports, role).toHaveLength(2);
    const [latest, first] = reports.map((r) => r.body as ReportBody);
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
  expect(await count('reports')).toBe(4);
  const { reports } = await listReports(db.driver, member.viewer);
  expect(reports).toHaveLength(4);
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
