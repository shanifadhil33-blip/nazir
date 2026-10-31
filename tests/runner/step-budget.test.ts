import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { fixture, journey, type Fixture } from './helpers';
import { runNextConversation, type Verdict } from '../../src/server/runner/worker';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { stepRun } from '../../src/server/livetest/drive';
import type { StepDeps } from '../../src/server/livetest/live-test';
import { conversationBudget, minConversationMs, stepBudgetMs, stepLeaseSeconds, stepRouteSeconds } from '../../src/server/livetest/budget';
import type { ChatModel } from '../../src/sandbox/agent';

let db: TestDatabase, f: Fixture, reviewer: string;
const ready = { INSPECT_DATABASE_URL: 'postgres://synthetic', ZAI_API_KEY: 'synthetic' };
const passed = (): Verdict => ({ status: 'passed', results: { checks: 1 } });
const enqueue = (repeats = 1) => enqueueRun(db.driver, { workspaceId: f.workspaceId, planId: f.planId, agentVersionId: f.versions.find((v) => v.registry_id === 'baseline')!.id, scenarioIds: f.scenarios.filter((s) => s.language === 'en').map((s) => s.id), repeats, idempotencyKey: crypto.randomUUID() });
/** The in request step as production wires it (budget as the conversation deadline, step lease), with a scripted model and no network. */
const deps = (model: () => ChatModel = journey, budgets: number[] = []): StepDeps => ({
  inspectionDriver: () => db.driver,
  run: ({ runId, budgetMs }) => { budgets.push(budgetMs); return runNextConversation({ driver: db.driver, inspectionDriver: db.driver, runId, workerId: 'live_test', chatModelFactory: model, evaluate: passed, conversationTimeoutMs: budgetMs, leaseSeconds: stepLeaseSeconds }); },
});
const conversations = async (run: string) => (await db.owner.query<{ status: string; attempt: number; last_error: string | null; available_at: Date }>('SELECT status,attempt,last_error,available_at FROM nazir.conversations WHERE run_id=$1 ORDER BY created_at,id', [run])).rows;

beforeAll(async () => { db = await testDatabase(); });
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  f = await fixture(db, 'budget_' + crypto.randomUUID());
  reviewer = await db.createMember(f.workspaceId, ['quality_reviewer'], 'Reviewer');
});
afterEach(() => { vi.useRealTimers(); });

it('keeps the step budget, lease and heartbeat inside a 60 s route', () => {
  expect(stepRouteSeconds).toBe(60);
  expect(stepBudgetMs).toBeLessThanOrEqual(50_000);
  expect(minConversationMs).toBeLessThan(stepBudgetMs);
  // The lease is renewed every third of itself, and a killed route frees its case within one lease.
  expect(stepLeaseSeconds).toBeGreaterThanOrEqual(10);
  expect(stepLeaseSeconds).toBeLessThanOrEqual(stepRouteSeconds);
  for (const route of ['src/app/api/workspaces/[workspaceId]/runs/[runId]/step/route.ts', 'src/app/api/workspaces/[workspaceId]/live-test/step/route.ts']) {
    expect(readFileSync(route, 'utf8')).toMatch(new RegExp(`export const maxDuration = ${stepRouteSeconds};`));
  }
  expect(conversationBudget(0, 0)).toBe(stepBudgetMs);
  expect(conversationBudget(0, 10_000)).toBe(stepBudgetMs - 10_000);
  expect(conversationBudget(0, stepBudgetMs - minConversationMs + 1)).toBe(0);
});

it('does one conversation per step, gives it what is left of the budget, and the next call continues', async () => {
  const run = await enqueue(2);
  const budgets: number[] = [];
  let clock = 1_000_000;
  const now = () => (clock += 2_000);
  const first = await stepRun(db.driver, reviewer, run.id, deps(journey, budgets), ready, now);
  expect(first).toMatchObject({ done: false, waiting: 1 });
  expect((await conversations(run.id)).map((c) => c.status)).toEqual(['passed', 'queued']);
  expect(budgets).toEqual([stepBudgetMs - 2_000]);
  const second = await stepRun(db.driver, reviewer, run.id, deps(journey, budgets), ready, now);
  expect(second).toMatchObject({ done: true, passed: 1, waiting: 0 });
  expect((await conversations(run.id)).map((c) => c.status)).toEqual(['passed', 'passed']);
});

it('claims nothing when too little of the budget is left, so the next call does the work', async () => {
  const run = await enqueue();
  let called = false, clock = 0;
  const slowChecks = () => (clock += stepBudgetMs - minConversationMs + 1);
  const p = await stepRun(db.driver, reviewer, run.id, { ...deps(), run: async () => { called = true; } }, ready, slowChecks);
  expect(called).toBe(false);
  expect(p).toMatchObject({ done: false, waiting: 1 });
  expect((await conversations(run.id))[0]).toMatchObject({ status: 'queued', last_error: null });
  expect(await stepRun(db.driver, reviewer, run.id, deps(), ready)).toMatchObject({ done: true, passed: 1 });
});

it('a conversation that runs past the budget is stopped at the budget, and the run resumes on a later step', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const run = await enqueue();
  const hangs: ChatModel = () => new Promise(() => {});
  let settled = false;
  const step = stepRun(db.driver, reviewer, run.id, deps(() => hangs), ready).finally(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(stepBudgetMs - 5_000);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(5_000);
  await vi.waitFor(() => expect(settled).toBe(true));
  expect(await step).toMatchObject({ done: false, waiting: 1 });
  expect((await conversations(run.id))[0]).toMatchObject({ status: 'queued', attempt: 1, last_error: 'timeout' });
  vi.useRealTimers();
  // The retry waits until available_at; once due, the next step finishes the case.
  await db.owner.query('UPDATE nazir.conversations SET available_at=now() WHERE run_id=$1', [run.id]);
  expect(await stepRun(db.driver, reviewer, run.id, deps(), ready)).toMatchObject({ done: true, passed: 1, waiting: 0 });
});
