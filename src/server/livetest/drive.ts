import 'server-only';
import { requireRole } from '../auth/guard';
import { withMember, withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, NotFound } from '../http/errors';
import { caseResults, type CaseResult, type ReportConversation } from '../reports/build';
import { liveTestReady, type StepDeps } from './live-test';

export type RunProgress = { run_id: string; status: string; done: boolean; passed: number; failed: number; inconclusive: number; waiting: number; results?: CaseResult[] };

async function progress(driver: TransactionDriver, workspaceId: string, runId: string): Promise<RunProgress> {
  return withWorker(driver, workspaceId, async (sql) => {
    const row = (await sql.query<{ status: string }>('SELECT status FROM nazir.runs WHERE id=$1', [runId])).rows[0];
    if (!row) throw new NotFound();
    const conversations = (await sql.query<ReportConversation>('SELECT id,status,scenario_id,attempt_number,language FROM nazir.conversations WHERE run_id=$1 ORDER BY created_at,id', [runId])).rows;
    const results = caseResults(conversations);
    return { run_id: runId, status: row.status, done: ['passed', 'failed', 'inconclusive', 'cancelled'].includes(row.status), passed: results.filter((c) => c.status === 'passed').length, failed: results.filter((c) => c.status === 'failed').length, inconclusive: results.filter((c) => c.status === 'inconclusive').length, waiting: conversations.filter((c) => ['queued', 'running'].includes(c.status)).length, results };
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
