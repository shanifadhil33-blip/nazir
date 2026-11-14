import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ active: [] as { run_id: string }[], calls: [] as { name: string; message?: string }[], propose: { done: true, data: { id: '11111111-1111-4111-8111-111111111111' } } as { done: boolean; data: unknown } }));
vi.mock('../../src/server/runner/runs', () => ({ activeRuns: async () => ({ runs: state.active }) }));
vi.mock('../../src/server/agent/loop', () => ({ runAgentTool: async (_d: unknown, _m: string, name: string, _a: unknown, origin: { message?: string }) => {
  state.calls.push({ name, message: origin.message });
  if (name === 'propose_plan') return { ...state.propose, reply: { en: '', ar: '' } };
  return { done: true, data: { run_id: '22222222-2222-4222-8222-222222222222' }, reply: { en: '', ar: '' } };
} }));
import { startCheck } from '../../src/server/runner/start';
import { exactPlan } from '../../src/server/agent/intent';

beforeEach(() => { state.active = []; state.calls = []; state.propose = { done: true, data: { id: '11111111-1111-4111-8111-111111111111' } }; });
const driver = {} as never;

it('proposes and starts in one call with an exact approval no model has to read', async () => {
  expect(await startCheck(driver, 'm')).toEqual({ run_id: '22222222-2222-4222-8222-222222222222', existing: false });
  expect(state.calls.map((c) => c.name)).toEqual(['propose_plan', 'start_run']);
  expect(exactPlan(state.calls[1]!.message!)?.id).toBe('11111111-1111-4111-8111-111111111111');
});

it('returns the check already running instead of starting a second one', async () => {
  state.active = [{ run_id: '33333333-3333-4333-8333-333333333333' }];
  expect(await startCheck(driver, 'm')).toEqual({ run_id: '33333333-3333-4333-8333-333333333333', existing: true });
  expect(state.calls).toEqual([]);
});

it('says why a refused start failed, with 429 for daily limits', async () => {
  state.propose = { done: false, data: { ok: false, error: { code: 'daily_cap' } } };
  await expect(startCheck(driver, 'm')).rejects.toMatchObject({ status: 429, code: 'daily_cap' });
  state.propose = { done: false, data: null };
  await expect(startCheck(driver, 'm')).rejects.toMatchObject({ status: 409, code: 'start_failed' });
});
