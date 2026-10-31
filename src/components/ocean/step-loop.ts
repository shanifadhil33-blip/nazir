/**
 * The browser drives runs one step request at a time. Each step does bounded server work, so the loop below spaces
 * calls out: a short pause after progress, a growing pause with jitter when nothing moved or the step failed, no calls
 * while the tab is hidden, and never two step requests in flight from one tab.
 */
export type StepOutcome = 'progress' | 'idle' | 'error' | 'done' | 'stop';
export type LoopEnd = 'done' | 'stop' | 'errors' | 'idle' | 'steps';

export const stepPace = { baseMs: 1500, capMs: 15000, maxErrors: 3, maxIdle: 40, maxSteps: 400 };

/** Pause before the next step. misses counts steps in a row with no progress (idle or error); 0 after progress. */
export function backoffDelay(misses: number, random: () => number = Math.random, baseMs = stepPace.baseMs, capMs = stepPace.capMs) {
  if (misses <= 0) return baseMs;
  const ceiling = Math.min(capMs, baseMs * 2 ** misses);
  // Equal jitter: at least half the ceiling, never below the base pause, never above the cap.
  return Math.min(capMs, Math.max(baseMs, Math.round(ceiling * (0.5 + 0.5 * random()))));
}

/** Runs one task at a time, in call order. */
export function createLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

/** One lock per tab: run steps and live test steps share it. */
export const tabStepLock = createLock();

export type LoopEnv = { sleep: (ms: number) => Promise<void>; random: () => number; whenVisible: () => Promise<void> };

/** Resolves at once when the page is visible, otherwise on the next visibilitychange that makes it visible. */
export function whenVisible(doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | undefined = typeof document === 'undefined' ? undefined : document) {
  if (!doc || doc.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const seen = () => { if (doc.visibilityState !== 'hidden') { doc.removeEventListener('visibilitychange', seen); resolve(); } };
    doc.addEventListener('visibilitychange', seen);
  });
}

export const browserLoopEnv: LoopEnv = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random: Math.random, whenVisible: () => whenVisible() };

export async function driveSteps(step: () => Promise<StepOutcome>, { env = browserLoopEnv, lock = tabStepLock, pace = stepPace }: { env?: LoopEnv; lock?: ReturnType<typeof createLock>; pace?: typeof stepPace } = {}): Promise<LoopEnd> {
  let misses = 0, errors = 0, idle = 0;
  for (let n = 0; n < pace.maxSteps; n++) {
    await env.whenVisible();
    const outcome = await lock(step).catch((): StepOutcome => 'error');
    if (outcome === 'done' || outcome === 'stop') return outcome;
    if (outcome === 'progress') { misses = 0; errors = 0; idle = 0; }
    else if (outcome === 'error') { misses++; if (++errors > pace.maxErrors) return 'errors'; }
    else { misses++; errors = 0; if (++idle >= pace.maxIdle) return 'idle'; }
    await env.sleep(backoffDelay(misses, env.random, pace.baseMs, pace.capMs));
  }
  return 'steps';
}
