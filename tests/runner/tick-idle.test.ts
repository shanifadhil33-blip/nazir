import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { tick } from '../../src/server/runner/tick';

it('keeps watching for new work before it lets go, and picks up a check that arrives meanwhile', async () => {
  const waits: number[] = [];
  let calls = 0;
  const driver = { transaction: async (work: (sql: unknown) => unknown) => work({ query: async () => ({ rows: calls++ === 2 ? [{ run_id: 'r', workspace_id: 'w', started_by: 'm' }] : [] }) }) } as never;
  const run = vi.fn(async () => null);
  const none = { pending: async () => [], step: async () => ({ advanced: false }) };
  const result = await tick({ safety: none, driver, inspectionDriver: driver, lock: async () => async () => {}, run, wait: async (ms) => { waits.push(ms); }, idleWatchMs: 4000, budgetMs: 200_000, now: () => 0 });
  expect(result).toEqual({ busy: false, pending: false });
  expect(calls).toBeGreaterThan(3);
  expect(waits.filter((ms) => ms === 2000).length).toBeGreaterThanOrEqual(2);
  const quick = await tick({ safety: none, driver: { transaction: async (work: (sql: unknown) => unknown) => work({ query: async () => ({ rows: [] }) }) } as never, inspectionDriver: driver, lock: async () => async () => {}, wait: async () => { throw new Error('no wait without idle watch'); } });
  expect(quick).toEqual({ busy: false, pending: false });
});
