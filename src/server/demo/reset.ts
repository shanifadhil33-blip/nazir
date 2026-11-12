import 'server-only';
import { requireRole } from '../auth/guard';
import { withMember, withWorker } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { Coded } from '../http/errors';
import { closeStuckRuns } from './stale';

export const demoResetHours = 6;
const defaultCap = 262144;

export function demoCap(env: Record<string, string | undefined> = process.env) {
  const raw = env.DEMO_STORAGE_CAP_BYTES;
  if (raw === undefined || raw === '') return defaultCap;
  if (!/^\d+$/.test(raw)) throw new Error('Invalid storage cap');
  const value = Number(raw);
  if (value < 1 || value > 100000000) throw new Error('Invalid storage cap');
  return value;
}

function refused(error: unknown): never {
  if (String(error).includes('not a demo')) throw new Coded(403, 'not_demo', 'This workspace is not a demo.');
  throw error;
}
async function recycle(sql: SqlConnection, workspaceId: string, cap: number, reason: 'schedule' | 'on_demand', at: Date | null) {
  return Number((await sql.query<{ removed: number }>('SELECT nazir.demo_recycle($1,$2,$3,$4) AS removed', [workspaceId, cap, reason, at])).rows[0]!.removed);
}

/** On demand reset for one demo workspace. A real workspace is refused. Runs stuck for over an hour are cancelled too. */
export async function resetDemoNow(driver: TransactionDriver, memberId: string, workspaceId: string, cap = demoCap(), at: Date | null = null) {
  try {
    const removed = await withMember(driver, memberId, async (sql) => {
      await requireRole(sql, 'demo.reset');
      return recycle(sql, workspaceId, cap, 'on_demand', at);
    });
    const stuckRunsCancelled = await withWorker(driver, workspaceId, (sql) => closeStuckRuns(sql, at ?? new Date()));
    await withWorker(driver, workspaceId, (sql) => sql.query('SELECT nazir.worker_demo_reseed($1)', [workspaceId]));
    return { workspaceId, removed, capBytes: cap, stuckRunsCancelled };
  } catch (error) { refused(error); }
}

/** Scheduled reset. Each demo workspace runs at most once every 6 hours. */
export async function resetDemosDue(driver: TransactionDriver, cap = demoCap(), at: Date | null = null) {
  const ids = await driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_worker');
    return (await sql.query<{ id: string }>('SELECT id FROM nazir.demo_workspace_ids()')).rows.map((row) => row.id);
  });
  const results = [];
  for (const workspaceId of ids) {
    try {
      const removed = await withWorker(driver, workspaceId, (sql) => recycle(sql, workspaceId, cap, 'schedule', at));
      // A run stuck for over an hour is closed on every pass, so the 6 hour window above does not hold it back.
      const stuckRunsCancelled = await withWorker(driver, workspaceId, (sql) => closeStuckRuns(sql, at ?? new Date()));
      results.push({ workspaceId, removed, capBytes: cap, stuckRunsCancelled });
    } catch (error) { refused(error); }
  }
  return results;
}
