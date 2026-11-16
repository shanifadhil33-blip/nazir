import { beforeAll, afterAll, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: () => {} }));
import { randomUUID } from 'node:crypto';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { journey } from '../runner/helpers';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { runNextConversation } from '../../src/server/runner/worker';
import { createLibraryFixture } from '../../src/server/runner/library-fixture';
import { createReport } from '../../src/server/reports/read';
import { semantic } from '../judge/helpers';
import { fixAction, suggestFix } from '../../src/server/repair/lifecycle';

let db: TestDatabase;
let lib: Awaited<ReturnType<typeof createLibraryFixture>>;
beforeAll(async () => { vi.stubEnv('AI_DAILY_CAP_TEST_RUN', '2000'); db = await testDatabase(); lib = await db.driver.transaction(createLibraryFixture); }, 60000);
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });
const version = (id: string) => lib.versions.find((v) => v.registry_id === id)!.id;
async function drain() {
  while (await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'fix_worker', chatModelFactory: () => journey(), judgeFactory: () => async ({ input }) => semantic('supported', input.reply.slice(0, 60), 'none') }));
}
const list = (member: string) => db.member(member, async (sql) => (await sql.query<Record<string, unknown>>('SELECT * FROM nazir.list_proposals()')).rows);

it('keeps one open fix per wrong answer, then approve and test is tracked on the server until done', async () => {
  const run = await enqueueRun(db.driver, { workspaceId: lib.workspaceId, planId: lib.planId, agentVersionId: version('planted_wrong_queue'), scenarioIds: [lib.scenarios.complaint_en!, lib.scenarios.complaint_ar!], repeats: 1, idempotencyKey: randomUUID(), recordsOnly: false });
  await drain();
  const target = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.findings WHERE run_id=$1 AND check_id='right_queue' AND language='en'", [run.id])).rows[0]!;
  const first = await suggestFix(db.driver, lib.members.supplier, target.id);
  const again = await suggestFix(db.driver, lib.members.supplier, target.id);
  expect(again).toMatchObject({ id: first.id, existing: true });
  expect((await db.owner.query("SELECT count(*)::int AS n FROM nazir.proposals WHERE finding_id=$1 AND status='proposed'", [target.id])).rows[0]).toEqual({ n: 1 });
  // Parallel taps on two devices still give one open fix.
  const [x, y] = await Promise.all([suggestFix(db.driver, lib.members.supplier, target.id), suggestFix(db.driver, lib.members.supplier, target.id)]);
  expect(new Set([x.id, y.id, first.id]).size).toBe(1);

  const approved = await fixAction(db.driver, lib.members.reviewer, first.id, 'approve');
  expect(approved.retest_run_id).toBeTruthy();
  expect((await fixAction(db.driver, lib.members.reviewer, first.id, 'approve')).retest_run_id).toBe(approved.retest_run_id);
  let row = (await list(lib.members.reviewer)).find((r) => r.id === first.id)!;
  expect(row).toMatchObject({ status: 'approved', retest_run_id: approved.retest_run_id, retest_run_status: 'queued', own_agent: false, before_run_id: run.id });
  expect(Number(row.retest_total)).toBeGreaterThan(0);
  const retryBudget = (await db.owner.query<{ max_attempts: number }>('SELECT max_attempts FROM nazir.conversations WHERE run_id=$1', [approved.retest_run_id])).rows;
  expect(retryBudget.length).toBeGreaterThan(0);
  expect(retryBudget.every((c) => c.max_attempts === 1)).toBe(true);
  await drain();
  await createReport(db.driver, lib.members.reviewer, { run_id: approved.retest_run_id! });
  row = (await list(lib.members.reviewer)).find((r) => r.id === first.id)!;
  expect(row.retest_report_id).toBeTruthy();
  expect(row.retest_done).toBe(row.retest_total);
  expect(['passed', 'failed', 'inconclusive']).toContain(row.retest_run_status);
  // Approval metadata stays immutable, and the run link cannot be moved to another check.
  await expect(db.member(lib.members.reviewer, (sql) => sql.query('UPDATE nazir.proposals SET retest_run_id=NULL WHERE id=$1', [first.id]))).rejects.toThrow();
}, 180000);

it('Not now moves a fix to Done as skipped, and your own agent gets a plain instruction change', async () => {
  const run = await enqueueRun(db.driver, { workspaceId: lib.workspaceId, planId: lib.planId, agentVersionId: version('planted_false_submit'), scenarioIds: [lib.scenarios.complaint_en!], repeats: 1, idempotencyKey: randomUUID(), recordsOnly: false });
  await drain();
  const finding = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.findings WHERE run_id=$1 AND check_id='case_exists' LIMIT 1", [run.id])).rows[0]!;
  const fix = await suggestFix(db.driver, lib.members.supplier, finding.id);
  expect(await fixAction(db.driver, lib.members.reviewer, fix.id, 'reject')).toEqual({ id: fix.id, status: 'rejected' });
  expect((await list(lib.members.reviewer)).find((r) => r.id === fix.id)).toMatchObject({ status: 'rejected' });

  // An answer from your own agent: its version has no built in sample to patch.
  const own = (await db.owner.query<{ id: string }>("INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config,config_hash,frozen_at) SELECT workspace_id,agent_id,'Your agent','baseline','{}'::jsonb,'',now() FROM nazir.agent_versions WHERE id=$1 RETURNING id", [version('baseline')])).rows[0]!;
  const row = (await db.owner.query<{ row: Record<string, unknown> }>('SELECT to_jsonb(f) AS row FROM nazir.findings f WHERE id=$1', [finding.id])).rows[0]!.row;
  const external = randomUUID();
  await db.owner.query('INSERT INTO nazir.findings SELECT (jsonb_populate_record(NULL::nazir.findings,$1::jsonb)).*', [JSON.stringify({ ...row, id: external, agent_version_id: own.id, check_id: 'claim_without_action' })]);
  const mine = await suggestFix(db.driver, lib.members.supplier, external);
  expect(mine).toMatchObject({ patch: null, existing: false });
  const listed = (await list(lib.members.reviewer)).find((r) => r.id === mine.id)!;
  expect(listed).toMatchObject({ own_agent: true, instruction: { en: expect.stringContaining('filing tool returns a reference') } });
  expect((listed.instruction as { ar: string }).ar).toMatch(/[؀-ۿ]/);
}, 180000);

it('a sample wrong answer with no allowed change gets no fix card, and an old patchless fix cannot be approved', async () => {
  const run = await enqueueRun(db.driver, { workspaceId: lib.workspaceId, planId: lib.planId, agentVersionId: version('planted_wrong_queue'), scenarioIds: [lib.scenarios.complaint_en!], repeats: 1, idempotencyKey: randomUUID(), recordsOnly: false });
  await drain();
  // The wrong queue sample never fails to save a case, so no allowlisted change fits a case_exists answer on it.
  const odd = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.findings SELECT (jsonb_populate_record(NULL::nazir.findings, to_jsonb(f) || jsonb_build_object('id', gen_random_uuid(), 'check_id', 'case_exists', 'root_cause_class', 'adapter_failure', 'attempt', 9))).*
    FROM nazir.findings f WHERE f.run_id=$1 AND f.check_id='right_queue' LIMIT 1 RETURNING id`, [run.id])).rows[0]!;
  await expect(suggestFix(db.driver, lib.members.supplier, odd.id)).rejects.toMatchObject({ status: 409, code: 'no_fix' });
  expect((await db.owner.query('SELECT count(*)::int AS n FROM nazir.proposals WHERE finding_id=$1', [odd.id])).rows[0]).toEqual({ n: 0 });
  const { submitRepair } = await import('../../src/server/repair/proposals');
  const old = await submitRepair(db.driver, lib.members.supplier, { finding_id: odd.id, evidence: 'Made before fixes had to fit.' });
  expect(old.patch).toBeNull();
  await expect(fixAction(db.driver, lib.members.reviewer, old.id, 'approve')).rejects.toMatchObject({ status: 409, code: 'no_fix' });
  expect(await fixAction(db.driver, lib.members.reviewer, old.id, 'reject')).toEqual({ id: old.id, status: 'rejected' });
}, 120000);

it('a wrong answer from your connected agent gets the change to copy, even though its check ran on a library version', async () => {
  const run = await enqueueRun(db.driver, { workspaceId: lib.workspaceId, planId: lib.planId, agentVersionId: version('planted_false_submit'), scenarioIds: [lib.scenarios.complaint_en!], repeats: 1, idempotencyKey: randomUUID(), recordsOnly: false });
  await drain();
  // Live, checks against a connected agent freeze externalAgent in the manifest and keep the library version id.
  await db.owner.query('ALTER TABLE nazir.runs DISABLE TRIGGER USER');
  await db.owner.query(`UPDATE nazir.runs SET frozen_manifest=frozen_manifest||'{"externalAgent":{"revision":"r1","name":"Your agent","connectionKind":"sdk","scope":"full"}}'::jsonb WHERE id=$1`, [run.id]);
  await db.owner.query('ALTER TABLE nazir.runs ENABLE TRIGGER USER');
  const finding = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.findings WHERE run_id=$1 AND check_id='case_exists' LIMIT 1", [run.id])).rows[0]!;
  const mine = await suggestFix(db.driver, lib.members.supplier, finding.id);
  expect(mine).toMatchObject({ patch: null, existing: false });
  expect((await list(lib.members.reviewer)).find((r) => r.id === mine.id)).toMatchObject({ own_agent: true });
}, 120000);
