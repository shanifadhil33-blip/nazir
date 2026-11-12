import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { fixture, journey, type Fixture } from './helpers';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { runNextConversation } from '../../src/server/runner/worker';
import { cancelRun } from '../../src/server/runner/cancel';
import { mapError } from '../../src/server/http/errors';
import { estimateRun } from '../../src/server/runner/estimate';
import { planOrder } from '../../src/server/memory/planner';
import { approvePlan } from '../../src/server/memory/planner';
import { listRuns } from '../../src/server/agent/loop';
import { assembleReport, caseResults, projectReport } from '../../src/server/reports/build';
import { clientReportSections, reportScore } from '../../src/server/reports/pdf';
import { createReport, readFullReport } from '../../src/server/reports/read';

let db: TestDatabase, f: Fixture;
beforeAll(async () => { db = await testDatabase(); f = await fixture(db, 'repeat runs'); });
afterAll(async () => { await db?.close(); });
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const r of (await db.owner.query<{ id: string }>("SELECT id FROM nazir.runs WHERE workspace_id=$1 AND status IN ('queued','running')", [f.workspaceId])).rows) await cancelRun(db.driver, f.workspaceId, r.id);
});
const input = () => ({ workspaceId: f.workspaceId, planId: f.planId, agentVersionId: f.versions[0]!.id, scenarioIds: f.scenarios.filter((s) => s.language === 'en').map((s) => s.id), idempotencyKey: crypto.randomUUID() });

it('adds only the next migration with constrained counts, workspace RLS and explicit grants', async () => {
  const sql = await readFile('db/migrations/0029_repeat_runs.sql', 'utf8');
  expect(sql).toContain('BETWEEN 1 AND 3');
  expect(sql).toContain('FORCE ROW LEVEL SECURITY');
  expect(sql).toContain('GRANT SELECT,INSERT ON nazir.finding_attempts TO nazir_worker');
  expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DISABLE ROW LEVEL SECURITY/i);
  expect(sql).toContain('DEFAULT 1');
});
it.each([1, 2, 3])('queues %i independent attempts for a case with numbered attempts and multiplied estimate', async (repeats) => {
  const run = await enqueueRun(db.driver, { ...input(), repeats });
  const rows = (await db.owner.query('SELECT scenario_id,attempt_number,status FROM nazir.conversations WHERE run_id=$1 ORDER BY attempt_number', [run.id])).rows;
  expect(rows).toHaveLength(repeats);
  expect(rows.map((r) => r.attempt_number)).toEqual(Array.from({ length: repeats }, (_, i) => i + 1));
  const saved = (await db.owner.query('SELECT repeat_count,frozen_manifest FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!;
  expect(saved.repeat_count).toBe(repeats);
  expect(saved.frozen_manifest).toMatchObject({ repeatCount: repeats, estimatedCalls: 4 * repeats });
  await cancelRun(db.driver, f.workspaceId, run.id);
  expect((await db.owner.query("SELECT id FROM nazir.conversations WHERE run_id=$1 AND status<>'cancelled'", [run.id])).rows).toHaveLength(0);
});
it('defaults new enqueues to three and rejects invalid counts', async () => {
  const run = await enqueueRun(db.driver, input());
  expect((await db.owner.query('SELECT repeat_count FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!.repeat_count).toBe(3);
  for (const n of [0, 4, 1.5, NaN]) await expect(enqueueRun(db.driver, { ...input(), repeatsFor: { [input().scenarioIds[0]!]: n } })).rejects.toThrow('Invalid enqueue');
  for (const repeats of [0, 4, 1.5, NaN]) await expect(enqueueRun(db.driver, { ...input(), repeats })).rejects.toThrow();
});
it('refuses before inserting when repeated cost exceeds the plan or remaining daily cap in both languages', async () => {
  const limited = await fixture(db, 'repeat budget');
  await db.owner.query('UPDATE nazir.plans SET budget_calls=8 WHERE id=$1', [limited.planId]);
  const budget = await enqueueRun(db.driver, { ...input(), workspaceId: limited.workspaceId, planId: limited.planId, agentVersionId: limited.versions[0]!.id, scenarioIds: limited.scenarios.filter((s) => s.language === 'en').map((s) => s.id) }).catch((e) => e);
  vi.stubEnv('AI_DAILY_CAP_TEST_RUN', '1');
  await db.worker(f.workspaceId, (sql) => sql.query("SELECT nazir.ai_reserve('test_run','kilo','test',1,24)"));
  const daily = await enqueueRun(db.driver, input()).catch((e) => e);
  for (const [error, code] of [[budget, 'repeat_budget'], [daily, 'repeat_daily_cap']] as const) {
    expect(mapError(error).body.error.code).toBe(code);
    expect(mapError(error).body.error.message).toContain('exceed');
    expect(mapError(error, 'ar').body.error.message).toMatch(/[\u0600-\u06ff]/);
    for (const lang of ['en', 'ar'] as const) {
      const message = mapError(error, lang).body.error.message;
      expect(message).toContain('3');
      expect(message).toContain('12');
      expect(message).not.toMatch(/[-\u2013\u2014]/);
      expect(message).toContain(lang === 'ar' ? 'اختبارات أقل' : 'fewer tests');
    }
    expect(error.message).toContain('12 estimated calls');
  }
  expect((await db.owner.query('SELECT id FROM nazir.runs WHERE workspace_id=$1', [limited.workspaceId])).rows).toHaveLength(0);
});
it('executes all attempts, deduplicates failed checks, and preserves counts through stored reports and MCP data', async () => {
  const run = await enqueueRun(db.driver, { ...input(), agentVersionId: f.versions.find((v) => v.registry_id === 'planted_wrong_queue')!.id });
  for (let i = 0; i < 3; i++) {
    const result = await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'repeat_test', runId: run.id, chatModelFactory: () => journey() });
    expect(result).toMatchObject({ status: 'failed' });
  }
  expect((await db.owner.query('SELECT status FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!.status).toBe('failed');
  const findings = (await db.owner.query('SELECT id FROM nazir.findings WHERE run_id=$1 AND check_id=$2', [run.id, 'right_queue'])).rows;
  expect(findings).toHaveLength(1);
  expect((await db.owner.query('SELECT * FROM nazir.finding_attempts WHERE finding_id=$1', [findings[0]!.id])).rows).toHaveLength(3);
  const owner = (await db.owner.query<{ id: string }>('SELECT id FROM nazir.members WHERE workspace_id=$1', [f.workspaceId])).rows[0]!.id;
  const report = await createReport(db.driver, owner, { run_id: run.id });
  const body = await readFullReport(db.driver, owner, report.id);
  expect(body.counts).toMatchObject({ conversations: 1, passed: 0, failed: 1 });
  expect(body.cases?.[0]?.outcome.en).toBe('passed 0 of 3');
  expect(body.findings.find((f) => f.check_id === 'right_queue')?.failed_attempts).toBe(3);
  const runs = await listRuns(db.driver, owner);
  expect(runs.find((r) => r.id === run.id)?.results).toEqual(expect.arrayContaining([expect.objectContaining({ total: 3, passed: 0 })]));
});
it('only an owner or reviewer approves, with Full kept at three passes', async () => {
  const roles = ['service_owner', 'quality_reviewer', 'viewer'] as const;
  for (const [i, role] of roles.entries()) {
    const member = await db.createMember(f.workspaceId, [role]);
    const plan = (await db.owner.query<{ id: string }>("INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type) SELECT workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,'nazir' FROM nazir.plans WHERE id=$1 RETURNING id", [f.planId])).rows[0]!;
    await db.owner.query("UPDATE nazir.plans SET stop_rules=$2::jsonb WHERE id=$1", [plan.id, JSON.stringify({ scenario_ids: input().scenarioIds, budget: { kind: 'cost', perCall: 2 } })]);
    const approval = { id: plan.id, reason: 'I reviewed the test cases.', evidence_opened: true, repeat_count: i + 1 };
    if (role === 'viewer') await expect(approvePlan(db.driver, member, approval)).rejects.toThrow();
    else {
      await approvePlan(db.driver, member, approval);
      const saved = (await db.owner.query('SELECT repeat_count,stop_rules FROM nazir.plans WHERE id=$1', [plan.id])).rows[0]!;
      expect(saved.repeat_count).toBe(3);
      expect(saved.stop_rules).toMatchObject({ planned_calls: 8 * 3, planned_cost: 16 * 3 });
    }
    await expect(approvePlan(db.driver, member, { ...approval, repeat_count: 4 })).rejects.toThrow();
  }
});

it('scores cases strictly, marks mixed results flaky, and shows outcomes in English and Arabic PDF sections', () => {
  const conversations = ['passed', 'passed', 'failed'].map((status, i) => ({ id: `c${i}`, scenario_id: 'case', attempt_number: i + 1, status, language: 'en', split: 'development' }));
  const body = assembleReport({ run: { id: 'run', status: 'failed', calls_used: 0, calls_budget: 24 }, conversations, findings: [], messages: [] });
  expect(body.counts).toMatchObject({ conversations: 1, passed: 0, failed: 1 });
  expect(reportScore(body.counts)).toBe(0);
  expect(body.cases?.[0]).toMatchObject({ passed: 2, total: 3, flaky: true, outcome: { en: 'passed 2 of 3', ar: 'نجح 2 من 3' } });
  for (const lang of ['en', 'ar'] as const) {
    const sections = clientReportSections(body, { lang, agentName: '', focusPack: '', runDate: '', fontBytes: new Uint8Array() });
    expect(JSON.stringify(sections)).toContain(lang === 'en' ? 'passed 2 of 3' : 'نجح 2 من 3');
    expect(JSON.stringify(sections)).toContain(lang === 'en' ? 'Flaky' : 'متقلب');
  }
  expect(projectReport(body, 'development').counts).toEqual(body.counts);
  expect(caseResults(conversations.map((c) => ({ ...c, status: 'passed' })))[0]?.status).toBe('passed');
  expect(caseResults(conversations.map((c, i) => ({ ...c, status: i === 2 ? 'inconclusive' : 'passed' })))[0]?.status).toBe('inconclusive');
  const legacy = assembleReport({ run: body.run, conversations: [{ id: 'old', status: 'passed', language: 'en', split: 'development' }], findings: [], messages: [] });
  expect(legacy.counts).toMatchObject({ conversations: 1, passed: 1 });
  expect(legacy.cases?.[0]).toMatchObject({ passed: 1, total: 1, flaky: false });
});

it('keeps three attempts from a test_harder family lesson when the run count is one', async () => {
  const scenarios = (await db.owner.query<import('../../src/server/memory/planner').PlanScenario>("SELECT id,stable_key,language,family,split,meaning_id,checks FROM nazir.scenarios WHERE workspace_id=$1", [f.workspaceId])).rows;
  const lesson = { id: crypto.randomUUID(), version: 1, text: 'Test complaints harder.', text_ar: null, effect: { kind: 'test_harder' as const, family: 'complaint' as const, repeats: 3 as const }, scope: 'small', approved_by: null };
  const plan = planOrder(scenarios, {}, [lesson]);
  const run = await enqueueRun(db.driver, { ...input(), scenarioIds: plan.scenarioIds, repeats: 1, repeatsFor: plan.repeatsFor, lessons: plan.lessonsUsed });
  const rows = (await db.owner.query('SELECT id,scenario_id,attempt_number,status,language FROM nazir.conversations WHERE run_id=$1', [run.id])).rows;
  expect(rows).toHaveLength(plan.scenarioIds.length * 3);
  const saved = (await db.owner.query<{ frozen_manifest: { scenarios: { id: string; attempts: number }[] } }>('SELECT frozen_manifest FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!.frozen_manifest;
  expect(saved).toMatchObject({ repeatCount: 1, estimatedCalls: rows.length * 4, lessons: [expect.objectContaining({ effect: lesson.effect })] });
  expect(saved.scenarios).toEqual(expect.arrayContaining(plan.scenarioIds.map((id) => expect.objectContaining({ id, attempts: 3 }))));
  const report = assembleReport({ run: { id: run.id, status: 'passed', calls_used: 0, calls_budget: 60 }, conversations: rows.map((r) => ({ ...r, id: String(r.id), scenario_id: String(r.scenario_id), status: 'passed', split: 'development', language: String(r.language) })), findings: [], messages: [] });
  expect(report.cases?.every((c) => c.outcome.en === 'passed 3 of 3')).toBe(true);
});

it('estimates 48 single attempts below the free cap and uses planned costs and scenario overrides', () => {
  const ids = Array.from({ length: 48 }, (_, i) => String(i));
  expect(estimateRun(ids, 1)).toMatchObject({ attempts: 48, estimatedCalls: 192 });
  expect(estimateRun(ids, 3)).toMatchObject({ attempts: 144, estimatedCalls: 576 });
  expect(estimateRun(['a', 'b'], 1, { a: 3 }, { planned_calls: 6 })).toMatchObject({ attemptsFor: { a: 3, b: 1 }, attempts: 4, estimatedCalls: 12 });
  expect(estimateRun(['a'], 2, {}, { scenario_ids: ['a', 'b'], planned_calls: 6 }).estimatedCalls).toBe(6);
  expect(estimateRun(['a'], 3, {}, { planned_calls: 24, calls_per_attempt: 8 }).estimatedCalls).toBe(24);
});

it('uses a plan estimate for upfront checks and allows equality with the remaining cap', async () => {
  const planned = await fixture(db, 'planned repeat cost');
  const scenarioIds = planned.scenarios.map((s) => s.id);
  await db.owner.query('UPDATE nazir.plans SET budget_calls=12,stop_rules=$2::jsonb WHERE id=$1', [planned.planId, JSON.stringify({ scenario_ids: scenarioIds, planned_calls: 6 })]);
  const used = (await db.worker(planned.workspaceId, (sql) => sql.query<{ calls: number }>("SELECT calls FROM nazir.ai_usage_today() WHERE task='test_run'"))).rows.reduce((sum, row) => sum + Number(row.calls), 0);
  vi.stubEnv('AI_DAILY_CAP_TEST_RUN', String(used + 12));
  const args = { ...input(), workspaceId: planned.workspaceId, planId: planned.planId, agentVersionId: planned.versions[0]!.id, scenarioIds, repeats: 2 };
  const run = await enqueueRun(db.driver, args);
  expect((await db.owner.query<{ frozen_manifest: { estimatedCalls: number } }>('SELECT frozen_manifest FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!.frozen_manifest.estimatedCalls).toBe(12);
  await expect(enqueueRun(db.driver, { ...args, repeats: 3, idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: 'repeat_budget', details: { attempts: 6, estimatedCalls: 18 } });
});
