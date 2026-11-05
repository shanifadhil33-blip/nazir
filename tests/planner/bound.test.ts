import { afterAll, beforeAll, expect, it } from 'vitest';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import { Forbidden } from '../../src/server/http/errors';
import { applyBoundedStop } from '../../src/server/planner/stop';
import { boundPlan, callsPerScenario, defaultCallBudget, plannerPermissions, proposeBoundedPlan, sandboxToolNames, shouldStop, type PlanCandidate, type PlannerPermission } from '../../src/server/planner/bound';

const scenario = (id: string, family: string, language = 'en', calls = 4): PlanCandidate => ({ id, family, language, calls });
const held = [...plannerPermissions];
const base = { allowedTools: ['get_case_status'], heldPermissions: held, failures: {} as Record<string, number> };

it('orders by failure history and stays inside a call budget', () => {
  const plan = boundPlan({ ...base, scenarios: [scenario('a', 'alpha'), scenario('b', 'beta'), scenario('c', 'alpha', 'ar')], failures: { beta: 4, alpha: 1 }, budget: { kind: 'calls', max: 6 } });
  expect(plan.order[0]).toBe('beta');
  expect(plan.scenarioIds).toEqual(['b']);
  expect(plan.plannedCalls).toBe(4);
  expect(plan.plannedCalls).toBeLessThanOrEqual(6);
  expect(plan.stop).toEqual({ onBudget: 'stop', failureStreak: 3 });
  const wider = boundPlan({ ...base, scenarios: [scenario('a', 'alpha'), scenario('b', 'beta')], failures: { beta: 4 }, budget: { kind: 'calls', max: 8 } });
  expect(wider.scenarioIds).toEqual(['b', 'a']);
  expect(wider.plannedCalls).toBeLessThanOrEqual(8);
});
it('stops a cost budget before the next scenario would pass it', () => {
  const plan = boundPlan({ ...base, scenarios: [scenario('low', 'quiet', 'en', 2), scenario('hot', 'noisy', 'en', 2)], failures: { noisy: 9 }, budget: { kind: 'cost', max: 10, perCall: 3 } });
  expect(plan.scenarioIds).toEqual(['hot']);
  expect(plan.plannedCost).toBe(6);
  expect(plan.plannedCost).toBeLessThanOrEqual(10);
  expect(plan.callCeiling).toBe(3);
});
it('refuses a budget that fits no scenario', () => {
  expect(() => boundPlan({ ...base, scenarios: [scenario('a', 'alpha', 'en', 8)], budget: { kind: 'calls', max: 7 } })).toThrow(/too small/);
  expect(() => boundPlan({ ...base, scenarios: [scenario('a', 'alpha', 'en', 4)], budget: { kind: 'cost', max: 3, perCall: 2 } })).toThrow(/too small/);
});
it('never adds a tool or a permission', () => {
  const plan = boundPlan({ ...base, scenarios: [scenario('a', 'alpha', 'en', 1)], budget: { kind: 'calls', max: 1 } });
  expect(plan.tools).toEqual(['get_case_status']);
  expect(plan.permissions.every((item) => held.includes(item))).toBe(true);
  expect(() => boundPlan({ ...base, scenarios: [scenario('a', 'alpha', 'en', 1)], budget: { kind: 'calls', max: 1 }, requestedTools: ['get_case_status', 'export_all'] })).toThrow(/cannot add tools/);
  expect(() => boundPlan({ ...base, scenarios: [scenario('a', 'alpha', 'en', 1)], budget: { kind: 'calls', max: 1 }, requestedPermissions: ['plan.propose', 'release.decide'] as unknown as PlannerPermission[] })).toThrow(/cannot add permissions/);
  expect(() => boundPlan({ ...base, heldPermissions: ['plan.propose'], scenarios: [scenario('a', 'alpha', 'en', 1)], budget: { kind: 'calls', max: 1 }, requestedPermissions: ['plan.propose', 'finding.read'] })).toThrow(/cannot add permissions/);
});
it('sets the default call budget from the first chosen test', () => {
  expect(defaultCallBudget([8, 8])).toBe(8);
  expect(defaultCallBudget([24, 8])).toBe(24);
  expect(defaultCallBudget([])).toBe(callsPerScenario);
});
it('stops on the call ceiling, the cost ceiling, or the failure streak', () => {
  expect(shouldStop({ callsUsed: 8, callCeiling: 8, failureStreak: 0, failureStreakLimit: 3 })).toBe(true);
  expect(shouldStop({ callsUsed: 1, callCeiling: 8, failureStreak: 3, failureStreakLimit: 3 })).toBe(true);
  expect(shouldStop({ callsUsed: 1, callCeiling: 8, failureStreak: 0, failureStreakLimit: 3, costUsed: 10, costCeiling: 10 })).toBe(true);
  expect(shouldStop({ callsUsed: 1, callCeiling: 8, failureStreak: 1, failureStreakLimit: 3 })).toBe(false);
});

let db: TestDatabase;
let workspaceId: string;
let owner: string;
let reviewer: string;
let agentVersion: string;
let rulePack: string;
beforeAll(async () => {
  db = await testDatabase();
  const seeded = await seed(db, 'Planner');
  workspaceId = seeded.workspace_id;
  owner = seeded.member_id;
  reviewer = await db.createMember(workspaceId, ['quality_reviewer'], 'Khalid Hamdan');
  await db.createMember(workspaceId, ['viewer'], 'Hamza Nasser');
  await db.createMember(workspaceId, ['supplier_maintainer'], 'Yusuf Rahman');
  agentVersion = seeded.ids.agent_versions!;
  rulePack = seeded.ids.rule_pack_versions!;
  await db.owner.query("UPDATE nazir.scenarios SET status='approved' WHERE id=$1", [seeded.ids.scenarios]);
  const meaning = seeded.ids.scenario_meanings;
  const add = async (key: string, family: string, language: string) => (await db.owner.query<{ id: string }>(`INSERT INTO nazir.scenarios(workspace_id,meaning_id,stable_key,version,family,language,split,persona,starting_state,allowed_actions,forbidden_actions,expected_state,source_clause,expectation_kind,severity,rubric_version,status)
    VALUES($1,$2,$3,1,$4,$5,'development','{}','{}','{}','{}','{}','fictional','fictional_demo_rule','high','1','approved') RETURNING id`, [workspaceId, meaning, key, family, language])).rows[0]!.id;
  await add('planner_ar', 'test', 'ar');
  await add('planner_other', 'other_family', 'en');
}, 60000);
afterAll(async () => { await db?.close(); });

it('stores a plan whose calls fit the budget and puts the failing family first', async () => {
  const viewer = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.members WHERE display_name='Hamza Nasser'")).rows[0]!.id;
  const supplier = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.members WHERE display_name='Yusuf Rahman'")).rows[0]!.id;
  const before = Number((await db.owner.query<{ n: number }>('SELECT count(*)::int AS n FROM nazir.plans WHERE workspace_id=$1', [workspaceId])).rows[0]!.n);
  await expect(proposeBoundedPlan(db.driver, viewer, { agent_version_id: agentVersion, rule_pack_version_id: rulePack, budget: { kind: 'calls', max: (callsPerScenario * 3) } })).rejects.toBeInstanceOf(Forbidden);
  await expect(proposeBoundedPlan(db.driver, supplier, { agent_version_id: agentVersion, rule_pack_version_id: rulePack, budget: { kind: 'calls', max: (callsPerScenario * 3) }, tools: ['export_all'] })).rejects.toBeInstanceOf(Forbidden);
  await expect(proposeBoundedPlan(db.driver, reviewer, { agent_version_id: agentVersion, rule_pack_version_id: rulePack, budget: { kind: 'calls', max: (callsPerScenario * 3) }, tools: [...sandboxToolNames, 'export_all'] })).rejects.toThrow(/cannot add tools/);
  expect(Number((await db.owner.query<{ n: number }>('SELECT count(*)::int AS n FROM nazir.plans WHERE workspace_id=$1', [workspaceId])).rows[0]!.n)).toBe(before);
  const tight = await proposeBoundedPlan(db.driver, reviewer, { agent_version_id: agentVersion, rule_pack_version_id: rulePack, budget: { kind: 'calls', max: (callsPerScenario * 3) } });
  expect(tight.plannedCalls).toBe((callsPerScenario * 3));
  expect(tight.plannedCalls).toBeLessThanOrEqual((callsPerScenario * 3));
  expect(tight.order[0]).toBe('test');
  expect(tight.scenarioIds).toHaveLength(1);
  const room = await proposeBoundedPlan(db.driver, reviewer, { agent_version_id: agentVersion, rule_pack_version_id: rulePack, budget: { kind: 'calls', max: (callsPerScenario * 3) * 2 } });
  expect(room.scenarioIds).toHaveLength(2);
  expect(room.plannedCalls).toBe((callsPerScenario * 3) * 2);
  expect(room.order).toEqual(['test']);
  const stored = (await db.owner.query<{ budget_calls: number; stop_rules: { tools: string[]; permissions: string[]; scenario_ids: string[] } }>('SELECT budget_calls,stop_rules FROM nazir.plans WHERE id=$1', [room.id])).rows[0]!;
  expect(stored.budget_calls).toBe(room.plannedCalls);
  expect(stored.budget_calls).toBeLessThanOrEqual((callsPerScenario * 3) * 2);
  expect(stored.stop_rules.tools.every((name) => sandboxToolNames.includes(name))).toBe(true);
  expect(stored.stop_rules.permissions).not.toContain('release.decide');
  const audit = (await db.owner.query<{ action: string }>("SELECT action FROM nazir.audit_events WHERE target_id=$1 AND action='plan.proposed'", [room.id])).rows;
  expect(audit).toHaveLength(1);
  expect(owner).toBeTruthy();
  const open = await proposeBoundedPlan(db.driver, reviewer, { agent_version_id: agentVersion, rule_pack_version_id: rulePack });
  expect(open.plannedCalls).toBeGreaterThan(0);
  expect(open.plannedCalls).toBeLessThanOrEqual(open.budget.max);
  expect(open.scenarioIds.length).toBeGreaterThan(0);
});
it('cancels the rest of a bounded run when the failure streak is reached', async () => {
  const plan = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type,status)
    VALUES($1,'Stop','${agentVersion}','${rulePack}','{test}','{en}',1,80,'{"set":"bounded","stop":{"failure_streak":1}}','nazir','approved') RETURNING id`, [workspaceId])).rows[0]!;
  const scenarioId = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.scenarios WHERE workspace_id=$1 AND family='test' LIMIT 1", [workspaceId])).rows[0]!.id;
  const run = (await db.owner.query<{ id: string }>("INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,status,frozen_manifest,runner_version,calls_budget,calls_used) VALUES($1,$2,$3,$4,'running','{}','1',80,1) RETURNING id", [workspaceId, plan.id, agentVersion, rulePack])).rows[0]!;
  await db.owner.query("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,status,idempotency_key,finished_at) VALUES($1,$2,$3,'en','failed','done',clock_timestamp())", [workspaceId, run.id, scenarioId]);
  await db.owner.query("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,status,idempotency_key) VALUES($1,$2,$3,'ar','queued','later')", [workspaceId, run.id, scenarioId]);
  const cancelled = await db.worker(workspaceId, (sql) => applyBoundedStop(sql, run.id));
  expect(cancelled).toBe(1);
  expect((await db.owner.query<{ status: string }>("SELECT status FROM nazir.conversations WHERE run_id=$1 AND idempotency_key='later'", [run.id])).rows[0]!.status).toBe('cancelled');
});

it('counts a streak in different tests, and never stops a Quick check early', async () => {
  const mk = async (rules: string) => {
    const plan = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type,status)
      VALUES($1,'Stop','${agentVersion}','${rulePack}','{test}','{en}',1,80,'${rules}','nazir','approved') RETURNING id`, [workspaceId])).rows[0]!;
    const scenarioId = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.scenarios WHERE workspace_id=$1 AND family='test' LIMIT 1", [workspaceId])).rows[0]!.id;
    const run = (await db.owner.query<{ id: string }>("INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,status,frozen_manifest,runner_version,calls_budget,calls_used) VALUES($1,$2,$3,$4,'running','{}','1',80,1) RETURNING id", [workspaceId, plan.id, agentVersion, rulePack])).rows[0]!;
    for (const key of ['a', 'b', 'c']) await db.owner.query("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,status,idempotency_key,finished_at) VALUES($1,$2,$3,'en','failed',$4,clock_timestamp())", [workspaceId, run.id, scenarioId, key]);
    await db.owner.query("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,status,idempotency_key) VALUES($1,$2,$3,'ar','queued','later')", [workspaceId, run.id, scenarioId]);
    return run.id;
  };
  // Three failed attempts of one test are one failing test, so a limit of 3 does not stop.
  const same = await mk('{"set":"bounded","stop":{"failure_streak":3}}');
  expect(await db.worker(workspaceId, (sql) => applyBoundedStop(sql, same))).toBe(0);
  const quick = await mk('{"set":"bounded","size":"quick","stop":{"failure_streak":1}}');
  expect(await db.worker(workspaceId, (sql) => applyBoundedStop(sql, quick))).toBe(0);
});
