import type { RunProgress } from './checks-run';

export type ActiveChecks = { runs: RunProgress[]; status: 'loading' | 'ready' | 'error' };

export function initialActiveChecks(runs?: RunProgress[] | null): ActiveChecks {
  return { runs: runs ?? [], status: runs == null ? 'loading' : 'ready' };
}

/** Failed reads preserve the last card and revoke permission to assume emptiness. */
export function receiveActiveChecks(current: ActiveChecks, runs: RunProgress[] | null): ActiveChecks {
  return runs === null ? { ...current, status: 'error' } : { runs, status: 'ready' };
}

export function activeChecksEmpty(active: ActiveChecks): boolean {
  return active.status === 'ready' && active.runs.length === 0;
}
