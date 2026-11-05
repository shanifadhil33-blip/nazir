import 'server-only';
import { requireRole } from '../auth/guard';
import { withMember, withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, NotFound, runReasonLine, type ErrorCode } from '../http/errors';
import { caseResults, type CaseResult, type ReportConversation } from '../reports/build';
import { recoverStale } from '../runner/recover';
import { liveTestReady, type StepDeps } from './live-test';
import { conversationBudget } from './budget';

export type RunNote = { code: ErrorCode; en: string; ar: string };
export type RunProgress = { run_id: string; status: string; done: boolean; passed: number; failed: number; inconclusive: number; waiting: number; results?: CaseResult[]; notes: RunNote[] };

/** Plain lines for why conversations ended without a verdict, or are waiting for a retry. One line per kind. */
export function runNotes(rows: { status: string; inconclusive_reason?: string | null; last_error?: string | null }[]): RunNote[] {
  const notes = new Map<string, RunNote>();
  for (const row of rows) {
    const reason = row.status === 'inconclusive' ? row.inconclusive_reason : row.status === 'queued' ? row.last_error : null;
    const line = runReasonLine(reason);
    if (line && !notes.has(line.code)) notes.set(line.code, line);
  }
  return [...notes.values()];
}

async function progress(driver: TransactionDriver, workspaceId: string, runId: string): Promise<RunProgress> {
  return withWorker(driver, workspaceId, async (sql) => {
    const row = (await sql.query<{ status: string }>('SELECT status FROM nazir.runs WHERE id=$1', [runId])).rows[0];
    if (!row) throw new NotFound();
    const conversations = (await sql.query<ReportConversation & { last_error: string | null }>('SELECT id,status,scenario_id,attempt_number,language,inconclusive_reason,last_error FROM nazir.conversations WHERE run_id=$1 ORDER BY created_at,id', [runId])).rows;
    const results = caseResults(conversations);
    // Progress is counted in tests, not tries: a test is finished only when none of its repeats is still waiting.
    const unfinished = (c: (typeof results)[number]) => c.attempts.some((a) => ['queued', 'running', 'planned'].includes(a.status));
    const finished = results.filter((c) => !unfinished(c));
    return { run_id: runId, status: row.status, done: ['passed', 'failed', 'inconclusive', 'cancelled'].includes(row.status), passed: finished.filter((c) => c.status === 'passed').length, failed: finished.filter((c) => c.status === 'failed').length, inconclusive: finished.filter((c) => c.status === 'inconclusive').length, waiting: results.length - finished.length, results, notes: runNotes(conversations) };
  });
}

/**
 * Runs one queued conversation of a run the member's workspace owns. Only roles that start runs may drive one.
 * The work is bounded by the step budget (budget.ts): when too little time is left, nothing is claimed and the next call continues.
 */
export async function stepRun(driver: TransactionDriver, memberId: string, runId: unknown, deps: StepDeps, env: Record<string, string | undefined> = process.env, now: () => number = Date.now) {
  const startedAt = now();
  if (typeof runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(runId)) throw new Coded(400, 'validation', 'Check the details and try again.');
  const workspaceId = await withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'plan.approve');
    const row = (await sql.query<{ w: string }>('SELECT workspace_id AS w FROM nazir.runs WHERE id=$1 AND workspace_id=nazir.current_workspace_id()', [runId])).rows[0];
    if (!row) throw new NotFound();
    return row.w;
  });
  // A step that died earlier is retried once or ended before new work, so the run can always finish.
  await recoverStale(driver, workspaceId, runId);
  const before = await progress(driver, workspaceId, runId);
  if (before.done) return before;
  if (!liveTestReady(env)) throw new Coded(503, 'live_test_unavailable', 'The live test is not connected here yet. Nothing was queued.');
  const budgetMs = conversationBudget(startedAt, now());
  if (!budgetMs) return before;
  await deps.run({ driver, inspectionDriver: deps.inspectionDriver(), runId, budgetMs });
  return progress(driver, workspaceId, runId);
}
