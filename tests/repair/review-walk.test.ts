import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { journey } from '../runner/helpers';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { runNextConversation } from '../../src/server/runner/worker';
import { createLibraryFixture } from '../../src/server/runner/library-fixture';
import { semantic } from '../judge/helpers';
import { submitRepair, decideRepair, startRetest } from '../../src/server/repair/proposals';
import { compareRuns, readComparisons } from '../../src/server/compare/compare';
import { listFindings } from '../../src/server/findings/read';
import { runAgentTool } from '../../src/server/agent/loop';
import { Forbidden, errorLines, messageFor } from '../../src/server/http/errors';
import { actionErrors } from '../../src/server/agent/intent';

// The role walk: owner (service_owner), reviewer (quality_reviewer), viewer, plus the supplier who proposes.
// The server matrix is unchanged: supplier proposes, reviewer decides, owner and reviewer rerun and compare, viewer only reads.
let db: TestDatabase, lib: Awaited<ReturnType<typeof createLibraryFixture>>;
let owner: string, reviewer: string, supplier: string, viewer: string;
let finding: string, proposal: string, retestRun: string, baseRun: string;
const reason = 'Read the receipts and the queue; the routing map is restored to the approved one.';
const count = async (sql: string, args: unknown[] = []) => (await db.owner.query<{ n: number }>(sql, args)).rows[0]!.n;
async function drain() {
  while (await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'walk_worker', chatModelFactory: () => journey(), judgeFactory: () => async ({ input }) => semantic('supported', input.reply.slice(0, 60), 'none') }));
}
beforeAll(async () => {
  vi.stubEnv('AI_DAILY_CAP_TEST_RUN', '2000');
  db = await testDatabase(); lib = await db.driver.transaction(createLibraryFixture);
  owner = lib.members.author; reviewer = lib.members.reviewer; supplier = lib.members.supplier;
  viewer = await db.createMember(lib.workspaceId, ['viewer'], 'Sami Haddad');
  const version = lib.versions.find((v) => v.registry_id === 'planted_wrong_queue')!.id;
  const run = await enqueueRun(db.driver, { workspaceId: lib.workspaceId, planId: lib.planId, agentVersionId: version, scenarioIds: [lib.scenarios.complaint_en!, lib.scenarios.complaint_ar!], repeats: 1, idempotencyKey: crypto.randomUUID(), recordsOnly: false });
  baseRun = run.id;
  await drain();
  finding = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.findings WHERE run_id=$1 AND check_id='right_queue' AND language='en'", [baseRun])).rows[0]!.id;
}, 120000);
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });

it('lets every role read findings, and shows an empty list as an empty list', async () => {
  for (const who of [owner, reviewer, viewer]) expect((await listFindings(db.driver, who, {})).length).toBeGreaterThan(0);
  expect(await listFindings(db.driver, viewer, { status: 'no_such_status' })).toEqual([]);
  expect(await readComparisons(db.driver, viewer)).toEqual([]);
});
it('refuses propose for owner, reviewer and viewer; only the supplier proposes', async () => {
  for (const who of [owner, reviewer, viewer]) await expect(submitRepair(db.driver, who, { finding_id: finding, evidence: 'Case stored in the wrong queue.' })).rejects.toBeInstanceOf(Forbidden);
  expect(await count('SELECT count(*)::int AS n FROM nazir.proposals WHERE finding_id=$1', [finding])).toBe(0);
  proposal = (await submitRepair(db.driver, supplier, { finding_id: finding, evidence: 'Case stored in the wrong queue.' })).id;
  expect(await count("SELECT count(*)::int AS n FROM nazir.audit_events WHERE action='proposal.create' AND target_id::text=$1", [proposal])).toBe(1);
});
it('refuses rerun before approval with a plain bilingual line, not a role refusal', async () => {
  const error = await startRetest(db.driver, reviewer, { proposalId: proposal, sets: ['retest'] }).catch((e) => e);
  expect(error).not.toBeInstanceOf(Forbidden);
  expect(error.code).toBe('proposal_not_approved');
  expect(messageFor('proposal_not_approved', 'ar')).toMatch(/[؀-ۿ]/);
});
it('refuses approve for owner, viewer and supplier; the reviewer approves once even on a double tap', async () => {
  for (const who of [owner, viewer, supplier]) await expect(decideRepair(db.driver, who, { id: proposal, decision: 'approve', reason, evidence_opened: true })).rejects.toBeInstanceOf(Forbidden);
  expect(await count("SELECT count(*)::int AS n FROM nazir.approvals WHERE subject_id=$1", [proposal])).toBe(0);
  const taps = await Promise.all([1, 2].map(() => decideRepair(db.driver, reviewer, { id: proposal, decision: 'approve', reason, evidence_opened: true })));
  expect(taps.map((t) => t.status)).toEqual(['approved', 'approved']);
  expect(taps[0]!.version_id).toBe(taps[1]!.version_id);
  expect(taps.filter((t) => t.repeated)).toHaveLength(1);
  expect(await count("SELECT count(*)::int AS n FROM nazir.approvals WHERE subject_id=$1", [proposal])).toBe(1);
  expect(await count("SELECT count(*)::int AS n FROM nazir.audit_events WHERE action='proposal.decide' AND target_id::text=$1", [proposal])).toBe(1);
  expect(await count("SELECT count(*)::int AS n FROM nazir.plans WHERE stop_rules->>'retest_of_proposal'=$1", [proposal])).toBe(2);
  // A different decision after the fact is a clear refusal, not a second approval.
  const flip = await decideRepair(db.driver, reviewer, { id: proposal, decision: 'reject', reason, evidence_opened: true }).catch((e) => e);
  expect(flip.code).toBe('proposal_state');
});
it('refuses rerun for the viewer and the supplier; owner and reviewer rerun once per double tap with one audit row', async () => {
  for (const who of [viewer, supplier]) await expect(startRetest(db.driver, who, { proposalId: proposal, repeat_count: 1, sets: ['retest'] })).rejects.toBeInstanceOf(Forbidden);
  const [a, b] = await Promise.all([owner, reviewer].map((who) => startRetest(db.driver, who, { proposalId: proposal, repeat_count: 1, sets: ['retest'] })));
  expect(a!.retest).toBe(b!.retest);
  retestRun = a!.retest!;
  expect(await count("SELECT count(*)::int AS n FROM nazir.runs WHERE id=$1", [retestRun])).toBe(1);
  expect(await count("SELECT count(*)::int AS n FROM nazir.audit_events WHERE action='proposal.rerun' AND target_id::text=$1", [proposal])).toBe(1);
  expect(await count("SELECT count(*)::int AS n FROM nazir.audit_events WHERE action='run_enqueued' AND target_id::text=$1", [retestRun])).toBe(1);
  await drain();
});
it('refuses compare for viewer and supplier; owner and reviewer compare, and a repeat gives the same reproducible summary', async () => {
  for (const who of [viewer, supplier]) await expect(compareRuns(db.driver, who, { runA: baseRun, runB: retestRun })).rejects.toBeInstanceOf(Forbidden);
  const first = await compareRuns(db.driver, owner, { runA: baseRun, runB: retestRun });
  const second = await compareRuns(db.driver, reviewer, { runA: baseRun, runB: retestRun });
  // Comparisons are append only and reproducible: a repeat saves the same summary again, each with its own audit row.
  expect(second.summary_hash).toBe(first.summary_hash);
  expect(await count("SELECT count(*)::int AS n FROM nazir.audit_events WHERE action='comparison.created' AND target_id::text=$1", [first.id])).toBe(1);
  expect(first.summary.totals.improved).toBeGreaterThan(0);
  expect((await readComparisons(db.driver, owner)).length).toBe(2);
  // Comparing a run with an unknown run is a not found line, not a crash.
  const missing = await compareRuns(db.driver, owner, { runA: baseRun, runB: crypto.randomUUID() }).catch((e) => e);
  expect(missing.name).toBe('NotFound');
});
it('answers each step through the chat tools with a bilingual line, and refuses the viewer on every write', async () => {
  for (const tool of ['propose_repair', 'decide_repair', 'rerun_tests'] as const) await expect(runAgentTool(db.driver, viewer, tool, { finding_id: finding, proposal_id: proposal })).rejects.toBeInstanceOf(Forbidden);
  await expect(runAgentTool(db.driver, viewer, 'compare_runs', { run_a: baseRun, run_b: retestRun })).rejects.toBeInstanceOf(Forbidden);
  const again = await runAgentTool(db.driver, reviewer, 'decide_repair', { id: proposal, decision: 'approve', reason, evidence_opened: true });
  expect(again.done).toBe(true);
  const late = await runAgentTool(db.driver, reviewer, 'decide_repair', { id: proposal, decision: 'reject', reason, evidence_opened: true });
  expect(late.done).toBe(false);
  expect(late.reply.en).toMatch(/already decided/);
  expect(late.reply.ar).toMatch(/[؀-ۿ]/);
  const unknown = await runAgentTool(db.driver, supplier, 'propose_repair', { finding_id: crypto.randomUUID() });
  expect(unknown.done).toBe(false);
  expect(unknown.reply.ar).toMatch(/[؀-ۿ]/);
});
it('has an Arabic line for every new string and no dashes in the copy', () => {
  for (const code of ['proposal_state', 'proposal_not_approved'] as const) {
    expect(errorLines[code].ar).toMatch(/[؀-ۿ]/);
    for (const text of [errorLines[code].en, errorLines[code].ar]) expect(text).not.toMatch(/[-–—]/);
  }
  expect(actionErrors.four_eyes.ar).toMatch(/[؀-ۿ]/);
});
