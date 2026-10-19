import 'server-only';
import { z } from 'zod';
import { withMember, withWorker } from '../db/context';
import { requireRole } from '../auth/guard';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { enqueueRun } from '../runner/enqueue';
import { onePerKey, budgetFor, type RetestScenario } from '../repair/retest';
import { checkEffect, lessonReason, type LessonEffect } from './effects';
import type { FrozenLesson } from './frozen';

export type PlanScenario = RetestScenario & { checks: string[] | null; category: string | null };
export type PlanLesson = { id: string; version: number; text: string; text_ar: string | null; effect: LessonEffect; scope: string; approved_by: string | null };
/** Pure planning. Lessons go first (a reviewer said so), then failure history, then the family name. Lessons never add or remove a scenario. */
export function planOrder(scenarios: PlanScenario[], failures: Record<string, number>, lessons: PlanLesson[], baseRepeats = 1) {
  const all = onePerKey(scenarios) as PlanScenario[];
  const families = [...new Set(all.map((s) => s.family))];
  const boost = new Map<string, number>(), repeats: Record<string, number> = {}, used: FrozenLesson[] = [];
  lessons.forEach((l, i) => {
    const e = l.effect, weight = lessons.length - i;
    let touched: string[] = [];
    if (e.kind === 'test_first') touched = [e.family];
    if (e.kind === 'test_harder') { touched = [e.family]; repeats[e.family] = Math.max(repeats[e.family] ?? baseRepeats, e.repeats); }
    if (e.kind === 'check_queue') touched = families.filter((f) => all.some((s) => s.family === f && s.category === e.category && (s.checks ?? []).includes('right_queue')));
    if (e.kind === 'judge_note') touched = [e.family];
    touched = touched.filter((f) => families.includes(f));
    if (!touched.length) return;
    if (e.kind !== 'judge_note') for (const f of touched) boost.set(f, Math.max(boost.get(f) ?? 0, weight));
    used.push({ lesson_id: l.id, version: l.version, text: l.text, text_ar: l.text_ar, effect: e, reason: lessonReason(l.text, l.text_ar, e) });
  });
  const order = [...families].sort((a, b) => (boost.get(b) ?? 0) - (boost.get(a) ?? 0) || (failures[b] ?? 0) - (failures[a] ?? 0) || a.localeCompare(b));
  const ordered = order.flatMap((f) => all.filter((s) => s.family === f));
  const repeatsFor = Object.fromEntries(ordered.filter((s) => repeats[s.family]).map((s) => [s.id, repeats[s.family]!]));
  return { order, scenarioIds: ordered.map((s) => s.id), familyRepeats: repeats, repeatsFor, lessonsUsed: used };
}
async function inputs(sql: SqlConnection, families?: string[], languages?: string[]) {
  const scenarios = (await sql.query<PlanScenario>(`SELECT s.id,s.meaning_id,m.canonical->>'meaning_key' AS meaning_key,m.canonical->>'kind' AS meaning_kind,s.family,s.split,s.stable_key,s.language,(s.library_hash IS NOT NULL) AS library,s.checks,s.expected_state->>'category' AS category
    FROM nazir.scenarios s JOIN nazir.scenario_meanings m ON m.id=s.meaning_id WHERE s.status='approved' AND ($1::text[] IS NULL OR s.family=ANY($1)) AND ($2::text[] IS NULL OR s.language=ANY($2))`, [families ?? null, languages ?? null])).rows;
  const failures = Object.fromEntries((await sql.query<{ family: string; n: number }>(`SELECT s.family,count(*)::int AS n FROM nazir.findings f JOIN nazir.scenarios s ON s.id=f.scenario_id WHERE f.created_at>now()-interval '30 days' GROUP BY s.family`)).rows.map((r) => [r.family, r.n]));
  const rows = (await sql.query<PlanLesson>(`SELECT id,version,text,text_ar,effect,scope,approved_by FROM nazir.lessons WHERE status='active' AND effect IS NOT NULL AND (scope='small' OR approved_by IS NOT NULL) ORDER BY updated_at DESC,id`)).rows;
  // Re-check every stored effect at use time; anything outside the allowlist is ignored.
  const lessons = rows.flatMap((l) => { try { return [{ ...l, effect: checkEffect(l.effect) }]; } catch { return []; } });
  return { scenarios, failures, lessons };
}
const proposeInput = z.object({ agent_version_id: z.uuid(), rule_pack_version_id: z.uuid(), families: z.array(z.string().min(1).max(60)).max(20).optional(), languages: z.array(z.enum(['en', 'ar'])).min(1).max(2).optional(), budget_cap: z.number().int().min(1).max(2000).optional() }).strict();
/** Nazir proposes the next plan. It stays proposed until a reviewer or owner approves it. */
export async function proposeNextPlan(driver: TransactionDriver, workspaceId: string, value: unknown) {
  const input = proposeInput.parse(value);
  return withWorker(driver, workspaceId, async (sql) => {
    const { scenarios, failures, lessons } = await inputs(sql, input.families, input.languages);
    const plan = planOrder(scenarios, failures, lessons);
    if (!plan.scenarioIds.length) throw new Error('No approved scenarios');
    const calls = plan.scenarioIds.reduce((n, id) => n + (plan.repeatsFor[id] ?? 1), 0);
    const row = (await sql.query<{ id: string }>(`INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type,lessons_used)
      VALUES(nazir.current_workspace_id(),'Next plan from history and lessons',$1,$2,$3,$4,1,$5,$6::jsonb,'nazir',$7::jsonb) RETURNING id`,
    [input.agent_version_id, input.rule_pack_version_id, plan.order, input.languages ?? ['en', 'ar'], budgetFor(calls, input.budget_cap ?? 2000),
      JSON.stringify({ set: 'next', order: plan.order, family_repeats: plan.familyRepeats, scenario_ids: plan.scenarioIds, failures, records_only: false }), JSON.stringify(plan.lessonsUsed)])).rows[0]!;
    await sql.query("SELECT nazir.append_audit('plan.proposed','plan',$1,$2)", [row.id, JSON.stringify({ lessons: plan.lessonsUsed.map((l) => l.lesson_id), order: plan.order })]);
    return { id: row.id, ...plan };
  });
}
export async function approvePlan(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = z.object({ id: z.uuid(), reason: z.string().trim().min(10).max(2000), evidence_opened: z.boolean() }).strict().parse(value);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'plan.approve');
    await sql.query(`INSERT INTO nazir.approvals(workspace_id,subject_type,subject_id,decision,reason,evidence_opened,decided_by,decided_by_name_at_event,decided_by_roles_at_event)
      VALUES(nazir.current_workspace_id(),'plan',$1,'approve',$2,$3,nazir.current_member_id(),'','{}')`, [input.id, input.reason, input.evidence_opened]);
    const row = (await sql.query<{ id: string }>("UPDATE nazir.plans SET status='approved' WHERE id=$1 AND status='proposed' RETURNING id", [input.id])).rows[0];
    if (!row) throw new Error('Plan is not waiting');
    await sql.query("SELECT nazir.append_audit('plan.approved','plan',$1,'{}')", [row.id]);
    return row;
  });
}
/** Starts an approved next plan. The lessons it used are frozen into the run manifest. */
export async function startNextPlan(driver: TransactionDriver, memberId: string, planId: string) {
  z.uuid().parse(planId);
  const plan = await withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'plan.approve');
    return (await sql.query<{ workspace_id: string; agent_version_id: string; stop_rules: { scenario_ids: string[]; family_repeats: Record<string, number>; set?: string }; lessons_used: FrozenLesson[] | null }>("SELECT workspace_id,agent_version_id,stop_rules,lessons_used FROM nazir.plans WHERE id=$1 AND status='approved'", [planId])).rows[0];
  });
  if (!plan || plan.stop_rules.set !== 'next') throw new Error('Approved next plan required');
  const fam = await withWorker(driver, plan.workspace_id, async (sql) => (await sql.query<{ id: string; family: string }>('SELECT id,family FROM nazir.scenarios WHERE id=ANY($1::uuid[])', [plan.stop_rules.scenario_ids])).rows);
  const repeatsFor = Object.fromEntries(fam.filter((s) => plan.stop_rules.family_repeats[s.family]).map((s) => [s.id, plan.stop_rules.family_repeats[s.family]!]));
  return enqueueRun(driver, { workspaceId: plan.workspace_id, planId, agentVersionId: plan.agent_version_id, scenarioIds: plan.stop_rules.scenario_ids, repeats: 1, idempotencyKey: `next:${planId}`, order: plan.stop_rules.scenario_ids, repeatsFor, lessons: plan.lessons_used ?? [] });
}
