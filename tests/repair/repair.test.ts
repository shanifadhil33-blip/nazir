import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { journey } from '../runner/helpers';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { runNextConversation } from '../../src/server/runner/worker';
import { createLibraryFixture } from '../../src/server/runner/library-fixture';
import { semantic } from '../judge/helpers';
import { resolveRepairVersion, resolveExecutable, repairConfig, RepairRefused } from '../../src/server/repair/executable';
import { submitRepair, decideRepair, startRetest, readRetest, suggestRepair, draftRepairByNazir } from '../../src/server/repair/proposals';
import { selectRetest, onePerKey, budgetFor, type RetestScenario } from '../../src/server/repair/retest';
import { evidenceDigest } from '../../src/server/repair/evidence-digest';
import { readAuditChain, verifyAuditChain } from '../../src/server/audit/verify';
import { agentVersions } from '../../src/sandbox/versions';
import { routingMap } from '../../src/sandbox/demo-rule-pack';

it('allows only allowlisted repairs that change the parent', () => {
  const wq = resolveRepairVersion('planted_wrong_queue', [{ op: 'restore_routing', category: 'complaint' }]);
  expect(wq).toMatchObject({ id: 'repair', kind: 'repair' });
  expect(wq.routingMap).toEqual(routingMap);
  expect(wq.configHash).not.toBe(agentVersions.planted_wrong_queue.configHash);
  expect(wq.configHash).not.toBe(agentVersions.baseline.configHash);
  const fs = resolveRepairVersion('planted_false_submit', [{ op: 'remove_create_case_fault' }, { op: 'remove_false_submit_claim' }]);
  expect(fs.faults).toBeUndefined(); expect(fs.falseSubmitClaim).toBeUndefined();
  const partial = resolveRepairVersion('planted_false_submit', [{ op: 'remove_false_submit_claim' }]);
  expect(partial.faults).toEqual({ createCase: 'fail' }); expect(partial.falseSubmitClaim).toBeUndefined();
  expect(wq.disclosure.ar).toMatch(/[\u0600-\u06ff]/);
  const refused = (parent: string, patch: unknown) => { try { resolveRepairVersion(parent, patch); return null; } catch (e) { return (e as RepairRefused).code; } };
  expect(refused('baseline', [{ op: 'restore_routing', category: 'complaint' }])).toBe('no_change');
  expect(refused('planted_wrong_queue', [{ op: 'remove_create_case_fault' }])).toBe('no_change');
  expect(refused('planted_wrong_queue', [{ op: 'add_fault' }])).toBe('invalid_patch');
  expect(refused('planted_wrong_queue', [{ op: 'restore_routing', category: 'payments' }])).toBe('invalid_patch');
  expect(refused('planted_wrong_queue', [{ op: 'restore_routing', category: 'complaint', extra: 1 }])).toBe('invalid_patch');
  expect(refused('planted_wrong_queue', [])).toBe('invalid_patch');
  expect(refused('planted_wrong_queue', [{ op: 'restore_routing', category: 'complaint' }, { op: 'restore_routing', category: 'complaint' }])).toBe('duplicate_op');
  expect(refused('repair', [{ op: 'remove_create_case_fault' }])).toBe('unknown_parent');
  const config = repairConfig('planted_wrong_queue', [{ op: 'restore_routing', category: 'complaint' }]);
  expect(resolveExecutable(config)?.configHash).toBe(wq.configHash);
  expect(resolveExecutable({ ...config, executable_hash: '0'.repeat(64) })).toBeNull();
  expect(resolveExecutable({ registry_id: 'baseline' })).toBe(agentVersions.baseline);
});
it('suggests a patch from the cause table and says when a server change is needed', () => {
  expect(suggestRepair({ root_cause_class: 'workflow_failure', check_id: 'right_queue', evidence: {} }, 'planted_wrong_queue').patch).toEqual([{ op: 'restore_routing', category: 'complaint' }]);
  expect(suggestRepair({ root_cause_class: 'adapter_failure', check_id: 'case_exists', evidence: {} }, 'planted_false_submit').patch).toEqual([{ op: 'remove_create_case_fault' }, { op: 'remove_false_submit_claim' }]);
  const none = suggestRepair({ root_cause_class: 'missing_authorization', check_id: 'ownership', evidence: {} }, 'baseline');
  expect(none.patch).toBeNull(); expect(none.note?.en).toContain('server side change'); expect(none.note?.ar).toMatch(/[\u0600-\u06ff]/);
  expect(suggestRepair({ root_cause_class: 'workflow_failure', check_id: 'right_queue', evidence: {} }, 'baseline').patch).toBeNull();
});
it('selects affected, normal, retry and unseen related hidden cases, one per key', () => {
  const s = (id: string, family: string, split: string, kind: string, key: string, language = 'en', library = true, meaning = family + kind): RetestScenario => ({ id, meaning_id: meaning, meaning_key: meaning, meaning_kind: kind, family, split, stable_key: key, language, library });
  const finding = s('f1', 'complaint_vs_suggestion', 'development', 'trap', 'cvs_trap_en');
  const all = [finding, s('f2', 'complaint_vs_suggestion', 'development', 'trap', 'cvs_trap_ar', 'ar'), s('n1', 'complaint_vs_suggestion', 'development', 'normal', 'cvs_normal_en'),
    s('r1', 'repeated_request_duplicates', 'hidden', 'normal', 'dup_normal_en'), s('r2', 'repeated_request_duplicates', 'hidden', 'trap', 'dup_trap_en'),
    s('h1', 'wrong_routing_queue', 'hidden', 'normal', 'wrq_normal_en'), s('h2', 'wrong_routing_queue', 'hidden', 'trap', 'wrq_trap_en'),
    s('x1', 'broad_case_export', 'hidden', 'trap', 'bce_trap_en'), s('old', 'complaint', 'development', 'normal', 'cvs_normal_en', 'en', false)];
  const r = selectRetest(finding, all, new Set(['wrong_routing_queuetrap']));
  expect(r.affected).toEqual(['f2', 'f1']); expect(r.normal).toEqual(['n1']); expect(r.retry).toEqual(['r1']); expect(r.hidden).toEqual(['h1']);
  expect(r.retest).toEqual(['f2', 'f1', 'n1', 'r1', 'h1']);
  expect(r.suite).not.toContain('old');
  expect(onePerKey(all).map((x) => x.id)).not.toContain('old');
  expect(budgetFor(5, 400)).toBe(40); expect(budgetFor(100, 400)).toBe(400);
});

let db: TestDatabase, lib: Awaited<ReturnType<typeof createLibraryFixture>>;
beforeAll(async () => { vi.stubEnv('AI_DAILY_CAP_TEST_RUN', '2000'); db = await testDatabase(); lib = await db.driver.transaction(createLibraryFixture); }, 60000);
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });
const version = (id: string) => lib.versions.find((v) => v.registry_id === id)!.id;
async function drain(model = journey()) {
  while (await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'repair_worker', chatModelFactory: () => model, judgeFactory: () => async ({ input }) => semantic('supported', input.reply.slice(0, 60), 'none') }));
}
async function plantedRun(registry: string) {
  const run = await enqueueRun(db.driver, { workspaceId: lib.workspaceId, planId: lib.planId, agentVersionId: version(registry), scenarioIds: [lib.scenarios.complaint_en!, lib.scenarios.complaint_ar!], repeats: 1, idempotencyKey: crypto.randomUUID(), recordsOnly: false });
  await drain();
  const findings = (await db.owner.query<{ id: string; check_id: string; language: string; root_cause_class: string }>('SELECT id,check_id,language,root_cause_class FROM nazir.findings WHERE run_id=$1 ORDER BY language,check_id', [run.id])).rows;
  return { run: run.id, findings };
}
const reason = 'Read the receipts and the queue; the routing map is restored to the approved one.';

it('runs the full repair cycle and keeps the old records unchanged', async () => {
  const { run, findings } = await plantedRun('planted_wrong_queue');
  const target = findings.find((f) => f.check_id === 'right_queue' && f.language === 'en')!;
  expect(target.root_cause_class).toBe('workflow_failure');
  const before = await evidenceDigest(db.driver, lib.workspaceId, run);
  const supplier = lib.members.supplier, reviewer = lib.members.reviewer;
  const proposal = await submitRepair(db.driver, supplier, { finding_id: target.id, evidence: 'Case stored in general_information while the tools said success.' });
  expect(proposal).toMatchObject({ status: 'proposed', patch: [{ op: 'restore_routing', category: 'complaint' }] });
  expect(proposal.title.ar).toMatch(/[\u0600-\u06ff]/);
  expect((await db.owner.query('SELECT count(*)::int AS n FROM nazir.library_fix_usage WHERE workspace_id=$1', [lib.workspaceId])).rows[0]).toEqual({ n: 1 });
  await expect(decideRepair(db.driver, supplier, { id: proposal.id, decision: 'approve', reason, evidence_opened: true })).rejects.toThrow();
  await expect(decideRepair(db.driver, reviewer, { id: proposal.id, decision: 'approve', reason: 'Looks ok', evidence_opened: true })).rejects.toThrow();
  // Raw SQL cannot approve without a reasoned approval row, and members cannot write a repaired version.
  await expect(db.member(reviewer, (sql) => sql.query("UPDATE nazir.proposals SET status='approved' WHERE id=$1", [proposal.id]))).rejects.toThrow();
  const owner = lib.members.author;
  await expect(db.member(owner, (sql) => sql.query("INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config,config_hash,parent_version_id,frozen_at) SELECT workspace_id,agent_id,'x','repair',$1::jsonb,'',id,now() FROM nazir.agent_versions WHERE id=$2", [JSON.stringify(repairConfig('planted_wrong_queue', [{ op: 'restore_routing', category: 'complaint' }])), version('planted_wrong_queue')]))).rejects.toThrow();
  const decided = await decideRepair(db.driver, reviewer, { id: proposal.id, decision: 'approve', reason, evidence_opened: true });
  expect(decided.status).toBe('approved');
  const row = (await db.owner.query<{ kind: string; config: { registry_id: string; parent_registry_id: string }; config_hash: string; frozen_at: string | null; parent_version_id: string }>('SELECT kind,config,config_hash,frozen_at,parent_version_id FROM nazir.agent_versions WHERE id=$1', [decided.version_id])).rows[0]!;
  expect(row).toMatchObject({ kind: 'repair', config: { registry_id: 'repair', parent_registry_id: 'planted_wrong_queue' }, parent_version_id: version('planted_wrong_queue') });
  expect(row.frozen_at).toBeTruthy();
  expect(row.config_hash).toBe(resolveRepairVersion('planted_wrong_queue', [{ op: 'restore_routing', category: 'complaint' }]).configHash);
  await expect(decideRepair(db.driver, reviewer, { id: proposal.id, decision: 'reject', reason, evidence_opened: true })).rejects.toThrow();
  const sel = decided.retest!;
  expect(sel.affected).toHaveLength(2);
  expect(sel.retry.length).toBeGreaterThan(0);
  expect(sel.hidden.length).toBeGreaterThan(0);
  expect(sel.suite).toHaveLength(58);
  // The supplier sees hidden cases only as a count.
  const view = await readRetest(db.driver, supplier, proposal.id);
  expect(view.retest!.hidden_count).toBe(sel.retry.length + sel.hidden.length);
  expect(view.retest!.visible.every((s) => s.split === 'development')).toBe(true);
  const reviewerView = await readRetest(db.driver, reviewer, proposal.id);
  expect(reviewerView.retest!.hidden_count).toBe(0);
  // Retest run on the repaired version: the affected EN and AR cases now pass on the records.
  const runs = await startRetest(db.driver, reviewer, { proposalId: proposal.id, repeat_count: 1, sets: ['retest'] });
  expect((await startRetest(db.driver, reviewer, { proposalId: proposal.id, repeat_count: 1, sets: ['retest'] })).retest).toBe(runs.retest);
  await drain();
  const affected = (await db.owner.query<{ status: string; language: string }>('SELECT status,language FROM nazir.conversations WHERE run_id=$1 AND scenario_id=ANY($2::uuid[]) ORDER BY language', [runs.retest, sel.affected])).rows;
  expect(affected).toEqual([{ status: 'passed', language: 'ar' }, { status: 'passed', language: 'en' }]);
  const manifest = (await db.owner.query<{ frozen_manifest: { registry_id: string; manifestVersion: string; repair: { parent_registry_id: string } } }>('SELECT frozen_manifest FROM nazir.runs WHERE id=$1', [runs.retest])).rows[0]!.frozen_manifest;
  expect(manifest).toMatchObject({ registry_id: 'repair', manifestVersion: 'n29', repair: { parent_registry_id: 'planted_wrong_queue' } });
  // Frozen suite on the same version, records only, enqueued with one conversation per approved library scenario.
  const suite = await startRetest(db.driver, reviewer, { proposalId: proposal.id, repeat_count: 1, sets: ['suite'], recordsOnly: true });
  expect((await db.owner.query('SELECT count(*)::int AS n FROM nazir.conversations WHERE run_id=$1', [suite.suite])).rows[0]).toEqual({ n: 58 });
  const after = await evidenceDigest(db.driver, lib.workspaceId, run);
  expect(after).toEqual(before);
  expect((await db.owner.query<{ status: string }>('SELECT status FROM nazir.runs WHERE id=$1', [run])).rows[0]!.status).toBe('failed');
  const chain = await readAuditChain(db.owner, lib.workspaceId);
  expect(chain.map((e) => e.action)).toEqual(expect.arrayContaining(['proposal.create', 'proposal.decide', 'agent_version.repair_created', 'plan.retest_created']));
  expect(verifyAuditChain(chain).ok).toBe(true);
  await db.owner.query("UPDATE nazir.conversations SET status='cancelled',finished_at=now() WHERE run_id=$1 AND status='queued'", [suite.suite]);
}, 180000);
it('keeps four eyes, requires reasons, and creates nothing on reject', async () => {
  const { findings } = await plantedRun('planted_false_submit');
  const target = findings.find((f) => f.check_id === 'case_exists' && f.language === 'en')!;
  expect(target.root_cause_class).toBe('adapter_failure');
  const both = await db.createMember(lib.workspaceId, ['supplier_maintainer', 'quality_reviewer'], 'Bilal Nasser');
  const own = await submitRepair(db.driver, both, { finding_id: target.id, evidence: 'Create failed and the reply said submitted.' });
  expect(own.patch).toEqual([{ op: 'remove_create_case_fault' }, { op: 'remove_false_submit_claim' }]);
  await expect(decideRepair(db.driver, both, { id: own.id, decision: 'approve', reason, evidence_opened: true })).rejects.toThrow();
  const rejected = await decideRepair(db.driver, lib.members.reviewer, { id: own.id, decision: 'reject', reason: 'The evidence does not show the cause yet.', evidence_opened: true });
  expect(rejected).toMatchObject({ status: 'rejected', version_id: null });
  expect((await db.owner.query('SELECT resulting_agent_version_id FROM nazir.proposals WHERE id=$1', [own.id])).rows[0]).toEqual({ resulting_agent_version_id: null });
  expect((await db.owner.query("SELECT count(*)::int AS n FROM nazir.plans WHERE stop_rules->>'retest_of_proposal'=$1", [own.id])).rows[0]).toEqual({ n: 0 });
  await expect(submitRepair(db.driver, lib.members.supplier, { finding_id: target.id, evidence: 'Changed patch', patch: [{ op: 'remove_false_submit_claim' }] })).rejects.toThrow();
  const partial = await submitRepair(db.driver, lib.members.supplier, { finding_id: target.id, evidence: 'Only the false claim first.', patch: [{ op: 'remove_false_submit_claim' }], cause_note: 'The case failure is a separate supplier ticket.' });
  const approved = await decideRepair(db.driver, lib.members.reviewer, { id: partial.id, decision: 'approve', reason: 'Honest failure message first, the case failure follows.', evidence_opened: true });
  expect(approved.version_id).toBeTruthy();
  const runs = await startRetest(db.driver, lib.members.reviewer, { proposalId: partial.id, sets: ['retest'], recordsOnly: true });
  await drain();
  const en = (await db.owner.query<{ status: string }>('SELECT c.status FROM nazir.conversations c WHERE run_id=$1 AND scenario_id=$2', [runs.retest, lib.scenarios.complaint_en])).rows[0]!;
  // The case still fails to save, but the reply no longer claims submission.
  expect(en.status).toBe('failed');
  const replies = (await db.owner.query<{ body: string }>("SELECT body FROM nazir.conversation_messages m JOIN nazir.conversations c ON c.id=m.conversation_id WHERE c.run_id=$1 AND c.scenario_id=$2 AND m.speaker='agent'", [runs.retest, lib.scenarios.complaint_en])).rows.map((r) => r.body).join(' ');
  expect(replies).not.toContain('reference pending');
}, 180000);
it('refuses approval without a patch, drifted versions and viewer reads', async () => {
  const { findings } = await plantedRun('planted_wrong_queue');
  const f = findings.find((x) => x.check_id === 'linked_escalation' && x.language === 'ar')!;
  const drafted = await draftRepairByNazir(db.driver, lib.workspaceId, f.id);
  expect(drafted.patch).toEqual([{ op: 'restore_routing', category: 'complaint' }]);
  const viewer = await db.createMember(lib.workspaceId, ['viewer'], 'Sami Haddad');
  expect(await db.member(viewer, async (sql) => (await sql.query('SELECT * FROM nazir.proposals')).rows)).toEqual([]);
  await expect(readRetest(db.driver, viewer, drafted.id)).rejects.toThrow();
  const ok = await decideRepair(db.driver, lib.members.reviewer, { id: drafted.id, decision: 'approve', reason: 'Nazir draft checked against the receipts.', evidence_opened: true });
  expect(ok.version_id).toBeTruthy();
  const bad = (await db.owner.query<{ id: string }>("INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config,config_hash,parent_version_id,frozen_at) SELECT workspace_id,agent_id,'drift','repair',$1::jsonb,'',id,now() FROM nazir.agent_versions WHERE id=$2 RETURNING id", [JSON.stringify({ ...repairConfig('planted_wrong_queue', [{ op: 'restore_routing', category: 'complaint' }]), executable_hash: 'a'.repeat(64) }), version('planted_wrong_queue')])).rows[0]!;
  await expect(enqueueRun(db.driver, { workspaceId: lib.workspaceId, planId: lib.planId, agentVersionId: bad.id, scenarioIds: [lib.scenarios.complaint_en!], repeats: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('drifted');
  await expect(db.owner.query("INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config,config_hash,frozen_at) SELECT workspace_id,agent_id,'x','repair','{\"registry_id\":\"baseline\"}','',now() FROM nazir.agent_versions WHERE id=$1", [version('baseline')])).rejects.toThrow();
  await expect(db.owner.query("INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config,config_hash,frozen_at) SELECT workspace_id,agent_id,'x','baseline',$1::jsonb,'',now() FROM nazir.agent_versions WHERE id=$2", [JSON.stringify(repairConfig('planted_wrong_queue', [{ op: 'restore_routing', category: 'complaint' }])), version('baseline')])).rejects.toThrow('Registry kind mismatch');
  const noPatch = (await db.owner.query<{ id: string }>("INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,evidence,expected_benefit,possible_regression,title,title_ar,root_cause_class) SELECT workspace_id,id,'nazir','evidence','benefit','regression','Investigate','تحقق',root_cause_class FROM nazir.findings WHERE id=$1 RETURNING id", [f.id])).rows[0]!;
  await expect(decideRepair(db.driver, lib.members.reviewer, { id: noPatch.id, decision: 'approve', reason, evidence_opened: true })).rejects.toThrow();
  await expect(db.owner.query("INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,evidence,expected_benefit,possible_regression,title,title_ar,root_cause_class) SELECT workspace_id,id,'nazir','evidence','benefit','regression','Investigate','تحقق','unknown' FROM nazir.findings WHERE id=$1", [f.id])).rejects.toThrow('Cause must match');
}, 180000);
