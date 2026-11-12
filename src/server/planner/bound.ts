import 'server-only';
import { z } from 'zod';
import { planSize } from '../packs/quick';
import { packById } from '../packs/catalog';
import { toolManifest } from '../../sandbox/tools';
import { can, type Role } from '../auth/roles';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { Coded, NotFound } from '../http/errors';
import { planInputs, planOrder } from '../memory/planner';
import type { FrozenLesson } from '../memory/frozen';
import { enqueueRun } from '../runner/enqueue';
import { runStarter } from '../runner/run-cap';
import { callsPerScenario } from '../repair/retest';

/** Tools this planner is allowed to call. A request cannot add to this list. */
export const plannerTools = ['list_runs', 'list_findings', 'propose_plan'] as const;
export type PlannerTool = typeof plannerTools[number];
/** Permissions this planner is allowed to use. A request cannot add to this list. */
export const plannerPermissions = ['plan.propose', 'finding.read', 'run.read'] as const;
export type PlannerPermission = typeof plannerPermissions[number];
export const sandboxToolNames = toolManifest.map((tool) => tool.function.name);
export { callsPerScenario };

/** Calls the first chosen test needs. An empty list falls back to one ordinary test. */
export function defaultCallBudget(calls: number[]) {
  const first = calls[0];
  return Number.isInteger(first) && (first ?? 0) > 0 ? first! : callsPerScenario;
}

export function rankFamilies(families: string[], failures: Record<string, number>, boost: Record<string, number> = {}) {
  return [...families].sort((a, b) => (boost[b] ?? 0) - (boost[a] ?? 0) || (failures[b] ?? 0) - (failures[a] ?? 0) || a.localeCompare(b));
}

export type Budget = { kind: 'calls'; max: number } | { kind: 'cost'; max: number; perCall: number };
export type PlanCandidate = { id: string; family: string; language: string; calls: number };
export type BoundPlan = {
  order: string[];
  scenarioIds: string[];
  plannedCalls: number;
  plannedCost: number | null;
  budget: Budget;
  callCeiling: number;
  stop: { onBudget: 'stop'; failureStreak: number };
  tools: string[];
  permissions: PlannerPermission[];
  failures: Record<string, number>;
};

const positive = z.number().int().min(1).max(2000);
export const budgetInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('calls'), max: positive }).strict(),
  z.object({ kind: z.literal('cost'), max: positive, perCall: positive }).strict(),
]);

export function toolNames(manifest: unknown): string[] | null {
  if (!Array.isArray(manifest)) return null;
  const names = manifest.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as { name?: unknown; function?: { name?: unknown } };
    const name = typeof record.function?.name === 'string' ? record.function.name : typeof record.name === 'string' ? record.name : null;
    return name ? [name] : [];
  });
  return names.length ? [...new Set(names)] : null;
}

function subset(requested: readonly string[], allowed: readonly string[], code: 'widens_tools' | 'widens_permissions', message: string) {
  if (requested.some((name) => !allowed.includes(name))) throw new Coded(403, code, message);
  return [...requested];
}

/** Pure plan. Failure history orders families. The result never exceeds the budget and never adds a tool or a permission. */
export function boundPlan(input: {
  scenarios: PlanCandidate[];
  failures: Record<string, number>;
  budget: Budget;
  failureStreak?: number;
  boost?: Record<string, number>;
  allowedTools: readonly string[];
  requestedTools?: readonly string[];
  heldPermissions: readonly PlannerPermission[];
  requestedPermissions?: readonly PlannerPermission[];
}): BoundPlan {
  const budget = budgetInput.parse(input.budget);
  const failureStreak = input.failureStreak ?? 3;
  if (!Number.isInteger(failureStreak) || failureStreak < 1 || failureStreak > 20) throw new Coded(400, 'validation', 'Check the details and try again.');
  const tools = subset(input.requestedTools ?? input.allowedTools, input.allowedTools, 'widens_tools', 'A plan cannot add tools.');
  if (tools.some((name) => !input.allowedTools.includes(name))) throw new Coded(403, 'widens_tools', 'A plan cannot add tools.');
  const permissions = subset(
    input.requestedPermissions ?? input.heldPermissions,
    input.heldPermissions,
    'widens_permissions',
    'A plan cannot add permissions.',
  ) as PlannerPermission[];
  if (permissions.some((name) => !plannerPermissions.includes(name))) throw new Coded(403, 'widens_permissions', 'A plan cannot add permissions.');
  const perCall = budget.kind === 'cost' ? budget.perCall : null;
  const callCeiling = budget.kind === 'calls' ? budget.max : Math.floor(budget.max / budget.perCall);
  if (callCeiling < 1) throw new Coded(400, 'budget_too_small', 'The budget is too small for a test.');
  const families = [...new Set(input.scenarios.map((scenario) => scenario.family))];
  const order = rankFamilies(families, input.failures, input.boost);
  const ranked = order.flatMap((family) => input.scenarios.filter((scenario) => scenario.family === family).sort((a, b) => a.language.localeCompare(b.language) || a.id.localeCompare(b.id)));
  const chosen: PlanCandidate[] = [];
  let plannedCalls = 0;
  for (const scenario of ranked) {
    if (!Number.isInteger(scenario.calls) || scenario.calls < 1) throw new Coded(400, 'validation', 'Check the details and try again.');
    const next = plannedCalls + scenario.calls;
    const nextCost = perCall === null ? 0 : next * perCall;
    if (next > callCeiling) break;
    if (perCall !== null && nextCost > budget.max) break;
    chosen.push(scenario);
    plannedCalls = next;
  }
  if (!chosen.length) throw new Coded(400, 'budget_too_small', 'The budget is too small for a test.');
  const plannedCost = perCall === null ? null : plannedCalls * perCall;
  return {
    order: [...new Set(chosen.map((scenario) => scenario.family))],
    scenarioIds: chosen.map((scenario) => scenario.id),
    plannedCalls, plannedCost, budget, callCeiling,
    stop: { onBudget: 'stop', failureStreak },
    tools, permissions, failures: input.failures,
  };
}

/** True when the run has spent its call or cost ceiling, or the failure streak is reached. */
export function shouldStop(state: { callsUsed: number; callCeiling: number; failureStreak: number; failureStreakLimit: number; costUsed?: number; costCeiling?: number | null }) {
  if (state.callsUsed >= state.callCeiling) return true;
  if (state.costCeiling != null && (state.costUsed ?? 0) >= state.costCeiling) return true;
  return state.failureStreakLimit > 0 && state.failureStreak >= state.failureStreakLimit;
}

export const proposeInput = z.object({
  size: planSize.default('full'),
  repeat_count: z.number().int().min(1).max(3).default(3),
  agent_version_id: z.uuid(),
  rule_pack_version_id: z.uuid(),
  budget: budgetInput.optional(),
  failure_streak: z.number().int().min(1).max(20).optional(),
  families: z.array(z.string().min(1).max(60)).max(20).optional(),
  languages: z.array(z.enum(['en', 'ar'])).min(1).max(2).optional(),
  tools: z.array(z.string().min(1).max(80)).max(20).optional(),
  permissions: z.array(z.enum(plannerPermissions)).max(plannerPermissions.length).optional(),
}).strict();

async function loadCandidates(sql: SqlConnection, families?: string[], languages?: string[]) {
  const scenarios = (await sql.query<{ id: string; family: string; language: string }>(`SELECT s.id,s.family,s.language FROM nazir.scenarios s
    WHERE s.status='approved' AND nazir.scenario_pack(s.starting_state)=nazir.current_focus_pack() AND ($1::text[] IS NULL OR s.family=ANY($1)) AND ($2::text[] IS NULL OR s.language=ANY($2))`, [families ?? null, languages ?? null])).rows;
  const failures = Object.fromEntries((await sql.query<{ family: string; n: number }>(`SELECT s.family,count(*)::int AS n FROM nazir.findings f
    JOIN nazir.scenarios s ON s.id=f.scenario_id WHERE f.created_at>now()-interval '30 days' AND nazir.scenario_pack(s.starting_state)=nazir.current_focus_pack() GROUP BY s.family`)).rows.map((row) => [row.family, row.n]));
  return { scenarios, failures };
}

/** Visible approved scenarios for this member. Hidden rows stay hidden. */
export async function visibleCandidates(driver: TransactionDriver, memberId: string, families?: string[], languages?: string[]) {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'plan.propose');
    return loadCandidates(sql, families, languages);
  });
}

/** Proposes a bounded plan for the signed in member, who must hold plan.propose. Nazir is the proposer of record; approval stays with a person. */
export async function proposeBoundedPlan(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = proposeInput.parse(value);
  input.repeat_count = input.size === 'quick' ? 1 : 3;
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'plan.propose');
    const version = (await sql.query<{ id: string; agent_id: string }>('SELECT id,agent_id FROM nazir.agent_versions WHERE id=$1', [input.agent_version_id])).rows[0];
    const rules = (await sql.query<{ id: string }>('SELECT id FROM nazir.rule_pack_versions WHERE id=$1', [input.rule_pack_version_id])).rows[0];
    if (!version || !rules) throw new NotFound();
    const manifest = (await sql.query<{ tool_manifest: unknown }>('SELECT tool_manifest FROM nazir.adapters WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 1', [version.agent_id])).rows[0]?.tool_manifest;
    const allowedTools = toolNames(manifest) ?? sandboxToolNames;
    const roles = (await sql.query<{ role: Role }>('SELECT role FROM nazir.member_roles WHERE member_id=nazir.current_member_id()')).rows.map((row) => row.role);
    const held = plannerPermissions.filter((action) => can(roles, action));
    const { scenarios, failures, lessons } = await planInputs(sql, input.families, input.languages, input.size);
    const ordered = planOrder(scenarios, failures, lessons);
    if (input.size === 'quick') ordered.repeatsFor = {};
    if (!ordered.scenarioIds.length) throw new Coded(409, 'no_tests', 'There is no approved test to plan.');
    const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
    const candidates = ordered.scenarioIds.flatMap((id) => {
      const scenario = byId.get(id);
      return scenario ? [{ id: scenario.id, family: scenario.family, language: scenario.language, calls: callsPerScenario * input.repeat_count }] : [];
    });
    const boost = Object.fromEntries(ordered.order.map((family, index) => [family, ordered.order.length - index]));
    const ranked = rankFamilies([...new Set(candidates.map((scenario) => scenario.family))], failures, boost)
      .flatMap((family) => candidates.filter((scenario) => scenario.family === family).sort((a, b) => a.language.localeCompare(b.language) || a.id.localeCompare(b.id)));
    const budget = input.budget ?? { kind: 'calls' as const, max: ranked.reduce((n, scenario) => n + scenario.calls, 0) || defaultCallBudget([]) };
    const plan = boundPlan({
      scenarios: candidates, failures, budget, boost, failureStreak: input.failure_streak, allowedTools,
      ...(input.tools ? { requestedTools: input.tools } : {}),
      heldPermissions: held,
      ...(input.permissions ? { requestedPermissions: input.permissions } : {}),
    });
    if (input.size === 'quick' && plan.scenarioIds.length !== 8) throw new Coded(400, 'budget_too_small', 'The budget is too small for a quick check.');
    const packId = (await sql.query<{ pack: string }>('SELECT nazir.current_focus_pack() AS pack')).rows[0]!.pack;
    const repeatsFor = Object.fromEntries(Object.entries(ordered.repeatsFor).filter(([id]) => plan.scenarioIds.includes(id)));
    const languages = input.languages ?? [...new Set(scenarios.filter((scenario) => plan.scenarioIds.includes(scenario.id)).map((scenario) => scenario.language))];
    const stopRules = { size: input.size, ...(input.size === 'quick' ? { quick_version: packById(packId)!.quick.version } : {}), set: 'bounded', budget: plan.budget, stop: { on_budget: plan.stop.onBudget, failure_streak: plan.stop.failureStreak }, order: plan.order, scenario_ids: plan.scenarioIds, failures, tools: plan.tools, permissions: plan.permissions, calls_per_attempt: callsPerScenario, planned_calls: plan.plannedCalls, planned_cost: plan.plannedCost, call_ceiling: plan.callCeiling, repeats_for: repeatsFor };
    const lessonsUsed = ordered.lessonsUsed;
    // A Quick check is what the Start button runs. Nazir proposes it and the person who tapped approves it, so one person can start
    // a check in their own workspace. Other plans keep a member as proposer, and nobody approves what they proposed themselves.
    // The member who asked is kept in the audit record.
    const asker = (await sql.query<{ id: string; wid: string }>('SELECT nazir.current_member_id() AS id, nazir.current_workspace_id() AS wid')).rows[0]!;
    const byNazir = input.size === 'quick';
    if (byNazir) {
      await sql.query('SET LOCAL ROLE nazir_worker');
      await sql.query("SELECT set_config('app.workspace_id',$1,true)", [asker.wid]);
    }
    const row = (await sql.query<{ id: string }>(`INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type,lessons_used,repeat_count)
      VALUES(nazir.current_workspace_id(),'Bounded plan from failure history',$1,$2,$3,$4,$8,$5,$6::jsonb,$9,$7::jsonb,$8) RETURNING id`,
    [input.agent_version_id, input.rule_pack_version_id, plan.order, languages.length ? languages : ['en'], plan.plannedCalls, JSON.stringify(stopRules), lessonsUsed.length ? JSON.stringify(lessonsUsed) : null, input.repeat_count, byNazir ? 'nazir' : 'member'])).rows[0]!;
    await sql.query("SELECT nazir.append_audit('plan.proposed','plan',$1,$2)", [row.id, JSON.stringify({ requested_by: asker.id, set: 'bounded', planned_calls: plan.plannedCalls, order: plan.order, lessons: lessonsUsed.map((lesson) => lesson.lesson_id) })]);
    return { id: row.id, ...plan, size: input.size, repeatCount: input.repeat_count, lessonsUsed };
  });
}

/** Queues an approved bounded plan. Approval stays on approvePlan, and the worker enqueue is unchanged. */
export async function startBoundedRun(driver: TransactionDriver, memberId: string, planId: string) {
  z.uuid().parse(planId);
  const plan = await withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'plan.approve');
    return (await sql.query<{ workspace_id: string; agent_version_id: string; repeat_count: number; stop_rules: { set?: string; scenario_ids?: string[]; repeats_for?: Record<string, number> }; lessons_used: FrozenLesson[] | null }>(
      "SELECT workspace_id,agent_version_id,repeat_count,stop_rules,lessons_used FROM nazir.plans WHERE id=$1 AND status='approved'",
      [planId],
    )).rows[0] ?? null;
  });
  if (!plan || plan.stop_rules.set !== 'bounded' || !plan.stop_rules.scenario_ids?.length) throw new Coded(409, 'not_approved', 'An approved plan is required.');
  const repeatsFor = plan.stop_rules.repeats_for && Object.keys(plan.stop_rules.repeats_for).length ? plan.stop_rules.repeats_for : undefined;
  const startedBy = await runStarter(driver, memberId);
  return enqueueRun(driver, {
    startedBy,
    workspaceId: plan.workspace_id,
    planId,
    agentVersionId: plan.agent_version_id,
    scenarioIds: plan.stop_rules.scenario_ids,
    repeats: plan.repeat_count,
    idempotencyKey: `bounded:${planId}`,
    order: plan.stop_rules.scenario_ids,
    ...(repeatsFor ? { repeatsFor } : {}),
    lessons: plan.lessons_used ?? [],
  });
}
