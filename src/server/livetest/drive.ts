import 'server-only';
import { requireRole } from '../auth/guard';
import { withMember, withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, NotFound } from '../http/errors';
import { liveTestReady, type StepDeps } from './live-test';

export type RunProgress = { run_id: string; status: string; done: boolean; passed: number; failed: number; inconclusive: number; waiting: number };

async function progress(driver: TransactionDriver, workspaceId: string, runId: string): Promise<RunProgress> {
  return withWorker(driver, workspaceId, async (sql) => {
    const row = (await sql.query<{ status: string; passed: string; failed: string; inconclusive: string; waiting: string }>(`SELECT r.status,
      count(*) FILTER (WHERE c.status='passed') AS passed, count(*) FILTER (WHERE c.status='failed') AS failed,
      count(*) FILTER (WHERE c.status='inconclusive') AS inconclusive, count(*) FILTER (WHERE c.status IN ('queued','running')) AS waiting
      FROM nazir.runs r LEFT JOIN nazir.conversations c ON c.run_id=r.id WHERE r.id=$1 GROUP BY r.status`, [runId])).rows[0];
    if (!row) throw new NotFound();
    return { run_id: runId, status: row.status, done: ['passed', 'failed', 'inconclusive', 'cancelled'].includes(row.status), passed: Number(row.passed), failed: Number(row.failed), inconclusive: Number(row.inconclusive), waiting: Number(row.waiting) };
  });
}

/** Runs one queued conversation of a run the member's workspace owns. Only roles that start runs may drive one. */
export async function stepRun(driver: TransactionDriver, memberId: string, runId: unknown, deps: StepDeps, env: Record<string, string | undefined> = process.env) {
  if (typeof runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(runId)) throw new Coded(400, 'validation', 'Check the details and try again.');
  const workspaceId = await withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'plan.approve');
    const row = (await sql.query<{ w: string }>('SELECT workspace_id AS w FROM nazir.runs WHERE id=$1 AND workspace_id=nazir.current_workspace_id()', [runId])).rows[0];
    if (!row) throw new NotFound();
    return row.w;
  });
  const before = await progress(driver, workspaceId, runId);
  if (before.done) return before;
  if (!liveTestReady(env)) throw new Coded(503, 'live_test_unavailable', 'The live test is not connected here yet. Nothing was queued.');
  await deps.run({ driver, inspectionDriver: deps.inspectionDriver(), runId });
  return progress(driver, workspaceId, runId);
}
