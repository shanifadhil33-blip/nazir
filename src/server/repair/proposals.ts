import 'server-only';
import { z } from 'zod';
import { withMember, withWorker } from '../db/context';
import { requireRole, Forbidden } from '../auth/guard';
import { NotFound } from '../http/errors';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { enqueueRun } from '../runner/enqueue';
import { runStarter } from '../runner/run-cap';
import { repairPatch, resolveRepairVersion, RepairRefused, type RepairPatch } from './executable';
import { budgetFor, selectRetest, type RetestScenario } from './retest';
import { hash } from '../../sandbox/demo-rule-pack';

type FindingRow = { id: string; check_id: string | null; root_cause_class: string; agent_said: string; scenario_id: string; agent_version_id: string; run_id: string; evidence: { receipts?: { tool?: string; outcome?: string }[]; observed?: unknown } };
export const repairTitles: Record<string, { en: string; ar: string; benefit: string; regression: string }> = {
  workflow_failure: { en: 'Restore the approved complaint routing', ar: 'إعادة توجيه الشكاوى المعتمد', benefit: 'Complaints and their review requests reach the complaint review queue again.', regression: 'Suggestions and information requests must keep their own queues.' },
  adapter_failure: { en: 'Stop the false submission claim and the planted case failure', ar: 'إيقاف ادعاء التقديم الكاذب وخلل إنشاء الحالة المزروع', benefit: 'A case is stored when the agent says submitted, and a failure is reported honestly.', regression: 'A real tool failure must still be reported as a failure, never as success.' },
  other: { en: 'Investigate this failure', ar: 'التحقق من هذا الإخفاق', benefit: 'The cause is found before any change is made.', regression: 'No change is proposed yet.' },
};
export const serverSideNote = { en: 'This cause needs a server side change, not a prompt change.', ar: 'يحتاج هذا السبب إلى تغيير في الخادم، وليس تغييرا في التعليمات.' };
/** Root cause first: the fixed cause to patch table (docs/repair.md). Only ops that change the parent are kept. */
export function suggestRepair(finding: Pick<FindingRow, 'root_cause_class' | 'check_id' | 'evidence'>, parentRegistryId: string): { patch: RepairPatch | null; note: { en: string; ar: string } | null } {
  const candidates: RepairPatch = [];
  if (finding.root_cause_class === 'workflow_failure' && ['right_queue', 'linked_escalation', 'reply_matches_record', 'semantic'].includes(String(finding.check_id))) candidates.push({ op: 'restore_routing', category: 'complaint' });
  if (finding.root_cause_class === 'adapter_failure') candidates.push({ op: 'remove_create_case_fault' }, { op: 'remove_false_submit_claim' });
  const useful = candidates.filter((op) => { try { resolveRepairVersion(parentRegistryId, [op]); return true; } catch { return false; } });
  return useful.length ? { patch: useful, note: null } : { patch: null, note: serverSideNote };
}
const uuid = z.uuid();
const submitInput = z.object({ finding_id: uuid, evidence: z.string().trim().min(3).max(2000), patch: z.unknown().optional(), expected_benefit: z.string().trim().min(3).max(1000).optional(), possible_regression: z.string().trim().min(3).max(1000).optional(), cause_note: z.string().trim().min(10).max(1000).optional() }).strict();
const decideInput = z.object({ id: uuid, decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(10).max(2000), evidence_opened: z.boolean() }).strict();
async function parentOf(sql: SqlConnection, finding: FindingRow) {
  const row = (await sql.query<{ config: { registry_id?: string } }>('SELECT config FROM nazir.agent_versions WHERE id=$1', [finding.agent_version_id])).rows[0];
  if (!row?.config.registry_id) throw new NotFound();
  return row.config.registry_id;
}
async function asWorker(sql: SqlConnection) {
  const wid = (await sql.query<{ id: string }>('SELECT nazir.current_workspace_id() AS id')).rows[0]!.id;
  await sql.query('SET LOCAL ROLE nazir_worker');
  await sql.query("SELECT set_config('app.workspace_id',$1,true)", [wid]);
  return wid;
}
/** Supplier proposes a repair for a finding. The patch must come from the allowlist and must change the version. */
export async function submitRepair(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = submitInput.parse(value);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'proposal.create');
    const finding = (await sql.query<FindingRow>('SELECT * FROM nazir.findings WHERE id=$1', [input.finding_id])).rows[0];
    if (!finding) throw new NotFound();
    const parent = await parentOf(sql, finding);
    const suggestion = suggestRepair(finding, parent);
    const patch = input.patch === undefined ? suggestion.patch : repairPatch.parse(input.patch);
    if (patch) resolveRepairVersion(parent, patch);
    if (patch && hash(patch) !== hash(suggestion.patch) && !input.cause_note) throw new RepairRefused('invalid_patch');
    const title = repairTitles[patch ? finding.root_cause_class : 'other'] ?? repairTitles.other!;
    const row = (await sql.query<{ id: string; status: string }>(`INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,proposed_by,evidence,patch,expected_benefit,possible_regression,title,title_ar,root_cause_class,cause_note,suggested_by_nazir)
      VALUES(nazir.current_workspace_id(),$1,'member',nazir.current_member_id(),$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10) RETURNING id,status`,
    [finding.id, input.evidence, patch ? JSON.stringify(patch) : null, input.expected_benefit ?? title.benefit, input.possible_regression ?? title.regression, title.en, title.ar, finding.root_cause_class, input.cause_note ?? null, input.patch === undefined])).rows[0]!;
    await sql.query("SELECT nazir.append_audit('proposal.create','proposal',$1,$2)", [row.id, JSON.stringify({ finding_id: finding.id, root_cause_class: finding.root_cause_class, patch_ops: patch?.map((p) => p.op) ?? [] })]);
    await asWorker(sql);
    await sql.query('SELECT nazir.repair_mark_used($1,$2)', [row.id, memberId]);
    return { ...row, patch, note: patch ? null : suggestion.note, title: { en: title.en, ar: title.ar } };
  });
}
async function scenariosFor(sql: SqlConnection) {
  return (await sql.query<RetestScenario>(`SELECT s.id,s.meaning_id,m.canonical->>'meaning_key' AS meaning_key,m.canonical->>'kind' AS meaning_kind,s.family,s.split,s.stable_key,s.language,(s.library_hash IS NOT NULL) AS library
    FROM nazir.scenarios s JOIN nazir.scenario_meanings m ON m.id=s.meaning_id WHERE s.status='approved'`)).rows;
}
/** Reviewer approves or rejects with a reason. Approval creates the frozen repaired version and the two retest plans. */
export async function decideRepair(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = decideInput.parse(value);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'proposal.decide');
    const p = (await sql.query<{ id: string; status: string; proposed_by: string | null; patch: RepairPatch | null; finding_id: string; title_ar: string | null }>('SELECT * FROM nazir.proposals WHERE id=$1 FOR UPDATE', [input.id])).rows[0];
    if (!p) throw new NotFound();
    if (!p.title_ar) throw new Forbidden();
    const me = (await sql.query<{ id: string }>('SELECT nazir.current_member_id() AS id')).rows[0]!.id;
    if (p.proposed_by === me || p.status !== 'proposed') throw new Forbidden();
    const finding = (await sql.query<FindingRow>('SELECT * FROM nazir.findings WHERE id=$1', [p.finding_id])).rows[0];
    if (!finding) throw new NotFound();
    let executable: string | null = null, parent: string | null = null;
    if (input.decision === 'approve') {
      if (!p.patch) throw new RepairRefused('invalid_patch');
      parent = await parentOf(sql, finding);
      executable = resolveRepairVersion(parent, p.patch).configHash;
    }
    const decision = (await sql.query<{ id: string }>(`INSERT INTO nazir.approvals(workspace_id,subject_type,subject_id,decision,reason,evidence_opened,decided_by,decided_by_name_at_event,decided_by_roles_at_event)
      VALUES(nazir.current_workspace_id(),'proposal',$1,$2,$3,$4,nazir.current_member_id(),'','{}') RETURNING id`, [p.id, input.decision, input.reason, input.evidence_opened])).rows[0]!;
    const status = input.decision === 'approve' ? 'approved' : 'rejected';
    await sql.query('UPDATE nazir.proposals SET status=$1 WHERE id=$2', [status, p.id]);
    await sql.query("SELECT nazir.append_audit('proposal.decide','proposal',$1,$2)", [p.id, JSON.stringify({ decision: input.decision, approval_id: decision.id, evidence_opened: input.evidence_opened })]);
    if (input.decision === 'reject') return { id: p.id, status, approval_id: decision.id, version_id: null, retest: null };
    const scenarios = await scenariosFor(sql);
    const used = new Set((await sql.query<{ k: string }>("SELECT coalesce(m.canonical->>'meaning_key',m.id::text) AS k FROM nazir.library_fix_usage u JOIN nazir.scenario_meanings m ON m.id=u.meaning_id")).rows.map((r) => r.k));
    const own = scenarios.find((s) => s.id === finding.scenario_id);
    if (!own) throw new NotFound();
    used.add(own.meaning_key ?? own.meaning_id);
    const selection = selectRetest(own, scenarios, used);
    await asWorker(sql);
    await sql.query('SELECT nazir.repair_mark_used($1,$2)', [p.id, me]);
    const made = (await sql.query<{ r: { version_id: string; retest_plan_id: string; suite_plan_id: string } }>('SELECT nazir.repair_materialize($1,$2,$3::uuid[],$4::uuid[],$5,$6) AS r',
      [p.id, executable, selection.retest, selection.suite, budgetFor(selection.retest.length * 3, 400), budgetFor(selection.suite.length * 3, 800)])).rows[0]!.r;
    return { id: p.id, status, approval_id: decision.id, version_id: made.version_id, parent_registry_id: parent, executable_hash: executable, retest: { ...selection, retest_plan_id: made.retest_plan_id, suite_plan_id: made.suite_plan_id } };
  });
}
type PlanRow = { id: string; agent_version_id: string; repeat_count: number; stop_rules: { set: 'retest' | 'suite'; scenario_ids: string[]; retest_of_proposal: string } };
/** Owner or reviewer starts the retest and then the frozen suite. Calling again returns the same runs. */
export async function startRetest(driver: TransactionDriver, memberId: string, input: { proposalId: string; sets?: ('retest' | 'suite')[]; recordsOnly?: boolean; repeat_count?: number }) {
  uuid.parse(input.proposalId);
  const repeatCount = z.number().int().min(1).max(3).optional().parse(input.repeat_count);
  const { wid, plans } = await withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'plan.approve');
    const p = (await sql.query<{ status: string; resulting_agent_version_id: string | null }>('SELECT status,resulting_agent_version_id FROM nazir.proposals WHERE id=$1', [input.proposalId])).rows[0];
    if (!p) throw new NotFound();
    if (p.status !== 'approved' || !p.resulting_agent_version_id) throw new Forbidden();
    const wid = (await sql.query<{ id: string }>('SELECT nazir.current_workspace_id() AS id')).rows[0]!.id;
    const plans = (await sql.query<PlanRow>("SELECT id,agent_version_id,repeat_count,stop_rules FROM nazir.plans WHERE status='approved' AND stop_rules->>'retest_of_proposal'=$1", [input.proposalId])).rows;
    return { wid, plans };
  });
  const out: Record<string, string> = {};
  const startedBy = await runStarter(driver, memberId);
  for (const set of input.sets ?? ['retest', 'suite']) {
    const plan = plans.find((x) => x.stop_rules.set === set);
    if (!plan) throw new NotFound();
    const run = await enqueueRun(driver, { workspaceId: wid, planId: plan.id, agentVersionId: plan.agent_version_id, scenarioIds: plan.stop_rules.scenario_ids, repeats: repeatCount ?? plan.repeat_count, idempotencyKey: `repair:${input.proposalId}:${set}:${repeatCount ?? plan.repeat_count}${input.recordsOnly ? ':records' : ''}`, recordsOnly: input.recordsOnly, order: plan.stop_rules.scenario_ids, startedBy });
    out[set] = run.id;
  }
  return out;
}
/** Retest lists for reading. A supplier sees hidden cases only as a count. */
export async function readRetest(driver: TransactionDriver, memberId: string, proposalId: string) {
  uuid.parse(proposalId);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'evidence.read');
    const plans = (await sql.query<PlanRow>("SELECT id,agent_version_id,repeat_count,stop_rules FROM nazir.plans WHERE stop_rules->>'retest_of_proposal'=$1", [proposalId])).rows;
    const result: Record<string, { plan_id: string; visible: { id: string; stable_key: string; language: string; split: string }[]; hidden_count: number }> = {};
    for (const plan of plans) {
      const visible = (await sql.query<{ id: string; stable_key: string; language: string; split: string }>('SELECT id,stable_key,language,split FROM nazir.scenarios WHERE id=ANY($1::uuid[]) ORDER BY stable_key,language', [plan.stop_rules.scenario_ids])).rows;
      result[plan.stop_rules.set] = { plan_id: plan.id, visible, hidden_count: plan.stop_rules.scenario_ids.length - visible.length };
    }
    return result;
  });
}
/** Worker path for proposals Nazir drafts itself from a finding. */
export async function draftRepairByNazir(driver: TransactionDriver, workspaceId: string, findingId: string) {
  uuid.parse(findingId);
  return withWorker(driver, workspaceId, async (sql) => {
    const finding = (await sql.query<FindingRow>('SELECT * FROM nazir.findings WHERE id=$1', [findingId])).rows[0];
    if (!finding) throw new NotFound();
    const parent = await parentOf(sql, finding);
    const suggestion = suggestRepair(finding, parent);
    const title = repairTitles[suggestion.patch ? finding.root_cause_class : 'other'] ?? repairTitles.other!;
    const row = (await sql.query<{ id: string }>(`INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,proposed_by,evidence,patch,expected_benefit,possible_regression,title,title_ar,root_cause_class,suggested_by_nazir)
      VALUES(nazir.current_workspace_id(),$1,'nazir',NULL,$2,$3::jsonb,$4,$5,$6,$7,$8,true) RETURNING id`,
    [finding.id, `Finding ${finding.check_id ?? 'check'}: ${finding.agent_said}`.slice(0, 2000), suggestion.patch ? JSON.stringify(suggestion.patch) : null, title.benefit, title.regression, title.en, title.ar, finding.root_cause_class])).rows[0]!;
    await sql.query("SELECT nazir.append_audit('proposal.create','proposal',$1,$2)", [row.id, JSON.stringify({ finding_id: finding.id, by: 'nazir' })]);
    return { id: row.id, patch: suggestion.patch, note: suggestion.note };
  });
}
