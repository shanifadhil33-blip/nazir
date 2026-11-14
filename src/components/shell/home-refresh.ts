import type { RunProgress } from './checks-run';

/** Lives for one workspace, across effect restarts and member data reloads. Never reseed it. */
export function homeRefreshMemory(seed?: RunProgress[] | null) {
  return { ids: new Set((seed ?? []).map((run) => run.runId)), kicked: new Map<string, number>(), flight: null as { promise: Promise<void>; retried: boolean } | null };
}

/** Poll often only while a check runs. A quiet Home asks rarely, and never reloads the page data. */
export const ACTIVE_POLL_MS = 5_000;
export const IDLE_POLL_MS = 30_000;
/** The server chains its own work. The browser kick is only a backup, so it is rare. */
export const KICK_EVERY_MS = 20_000;
export function nextPollDelay(memory: ReturnType<typeof homeRefreshMemory>) {
  return memory.ids.size > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}

function validRuns(value: unknown): value is RunProgress[] {
  return Array.isArray(value) && value.every((run) => run && typeof run.runId === 'string' && Number.isInteger(run.done) && Number.isInteger(run.total));
}

/** One observation path for polls and retries. Effects own the interval and dispose their binding. */
export function createHomeRefresh(memory: ReturnType<typeof homeRefreshMemory>, effects: {
  read: () => Promise<RunProgress[] | null>;
  receive: (runs: RunProgress[] | null) => void;
  kick: (runId: string) => Promise<unknown>;
  reload: () => void;
  now?: () => number;
}) {
  const now = effects.now ?? Date.now;
  let disposed = false;
  function refresh(retry = false): Promise<void> {
    if (disposed) return Promise.resolve();
    if (retry) effects.reload();
    if (memory.flight) {
      if (retry) memory.flight.retried = true;
      return memory.flight.promise;
    }
    const flight = { promise: Promise.resolve(), retried: retry };
    memory.flight = flight;
    flight.promise = (async () => {
      try {
        const result = await effects.read().catch(() => null);
        if (disposed) return;
        const runs = validRuns(result) ? result : null;
        effects.receive(runs);
        if (runs === null) return;
        const ids = new Set(runs.map((run) => run.runId));
        const disappeared = [...memory.ids].some((id) => !ids.has(id));
        memory.ids = ids;
        for (const id of [...memory.kicked.keys()]) if (!ids.has(id)) memory.kicked.delete(id);
        for (const run of runs) {
          const last = memory.kicked.get(run.runId);
          if (last !== undefined && now() - last < KICK_EVERY_MS) continue;
          memory.kicked.set(run.runId, now());
          void effects.kick(run.runId).catch(() => {});
        }
        if (disappeared && !flight.retried) effects.reload();
      } finally {
        if (memory.flight === flight) memory.flight = null;
      }
    })();
    return flight.promise;
  }
  return { refresh, dispose: () => { disposed = true; } };
}
