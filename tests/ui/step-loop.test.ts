import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { backoffDelay, browserLoopEnv, createLock, driveSteps, stepPace, whenVisible, type LoopEnv, type StepOutcome } from '../../src/components/ocean/step-loop';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** A document stand in: only visibilityState and visibilitychange. */
function fakeDocument(state: 'visible' | 'hidden' = 'visible') {
  const target = new EventTarget();
  return Object.assign(target, { visibilityState: state as DocumentVisibilityState, set(next: 'visible' | 'hidden') { this.visibilityState = next; target.dispatchEvent(new Event('visibilitychange')); } });
}
const env = (doc = fakeDocument(), random = () => 1): LoopEnv => ({ sleep: browserLoopEnv.sleep, random, whenVisible: () => whenVisible(doc) });
/** A scripted step: returns outcomes in order and records when each call started. */
function script(outcomes: StepOutcome[]) {
  const calls: number[] = [];
  const step = async () => { calls.push(Date.now()); return outcomes.shift() ?? 'done'; };
  return { step, calls };
}
const gaps = (calls: number[]) => calls.slice(1).map((t, i) => t - calls[i]!);

it('waits 1.5 s after progress, doubles with jitter when nothing moves or a step fails, caps at 15 s', () => {
  expect([0, 1, 2, 3, 4, 5, 9].map((m) => backoffDelay(m, () => 1))).toEqual([1500, 3000, 6000, 12000, 15000, 15000, 15000]);
  // Jitter keeps at least half the ceiling, and never goes under the base pause.
  expect([1, 2, 3, 4].map((m) => backoffDelay(m, () => 0))).toEqual([1500, 3000, 6000, 7500]);
  for (let m = 0; m < 12; m++) for (const r of [0, 0.3, 0.7, 1]) {
    const d = backoffDelay(m, () => r);
    expect(d).toBeGreaterThanOrEqual(stepPace.baseMs);
    expect(d).toBeLessThanOrEqual(stepPace.capMs);
  }
});

it('spaces step calls by the schedule and resets the backoff on progress', async () => {
  const { step, calls } = script(['progress', 'idle', 'error', 'idle', 'progress', 'idle', 'done']);
  const end = driveSteps(step, { env: env(), lock: createLock() });
  await vi.runAllTimersAsync();
  expect(await end).toBe('done');
  expect(gaps(calls)).toEqual([1500, 3000, 6000, 12000, 1500, 3000]);
});

it('gives up after three retries in a row, and after the idle limit', async () => {
  const errors = script(['error', 'error', 'error', 'error', 'progress']);
  const a = driveSteps(errors.step, { env: env(), lock: createLock() });
  await vi.runAllTimersAsync();
  expect(await a).toBe('errors');
  expect(errors.calls).toHaveLength(4);
  const idle = script(Array(50).fill('idle'));
  const b = driveSteps(idle.step, { env: env(), lock: createLock() });
  await vi.runAllTimersAsync();
  expect(await b).toBe('idle');
  expect(idle.calls).toHaveLength(stepPace.maxIdle);
  // A thrown step counts as an error, not a crash.
  const c = driveSteps(async () => { throw new Error('offline'); }, { env: env(), lock: createLock() });
  await vi.runAllTimersAsync();
  expect(await c).toBe('errors');
});

it('makes no step calls while the tab is hidden and resumes when it is shown again', async () => {
  const doc = fakeDocument('visible');
  const { step, calls } = script(['progress', 'progress', 'progress', 'done']);
  const end = driveSteps(step, { env: env(doc), lock: createLock() });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(1);
  doc.set('hidden');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toHaveLength(1);
  doc.set('visible');
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toHaveLength(2);
  await vi.runAllTimersAsync();
  expect(await end).toBe('done');
  expect(calls).toHaveLength(4);
});

it('starts hidden and waits for the tab to be shown before the first call', async () => {
  const doc = fakeDocument('hidden');
  const { step, calls } = script(['done']);
  const end = driveSteps(step, { env: env(doc), lock: createLock() });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(calls).toHaveLength(0);
  doc.set('visible');
  expect(await end).toBe('done');
  expect(calls).toHaveLength(1);
});

it('never has two step requests in flight from one tab, even with two loops', async () => {
  const lock = createLock();
  let inFlight = 0, most = 0, total = 0;
  const slowStep = (outcomes: StepOutcome[]) => async () => {
    inFlight++; most = Math.max(most, inFlight); total++;
    await new Promise((resolve) => setTimeout(resolve, 4000));
    inFlight--;
    return outcomes.shift() ?? 'done';
  };
  const both = Promise.all([
    driveSteps(slowStep(['progress', 'idle', 'progress']), { env: env(), lock }),
    driveSteps(slowStep(['idle', 'error', 'idle', 'progress']), { env: env(), lock }),
  ]);
  await vi.runAllTimersAsync();
  expect(await both).toEqual(['done', 'done']);
  expect(total).toBe(9);
  expect(most).toBe(1);
});

it('the lock keeps going after a failed task', async () => {
  const lock = createLock();
  await expect(lock(async () => { throw new Error('x'); })).rejects.toThrow('x');
  await expect(lock(async () => 2)).resolves.toBe(2);
});

it('stops at once when the step says stop', async () => {
  const { step, calls } = script(['progress', 'stop', 'progress']);
  const end = driveSteps(step, { env: env(), lock: createLock() });
  await vi.runAllTimersAsync();
  expect(await end).toBe('stop');
  expect(calls).toHaveLength(2);
});
