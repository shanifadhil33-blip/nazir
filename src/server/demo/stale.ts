import type { SqlConnection } from '../db/driver';

/**
 * Stale demo data. This file has no runtime imports so scripts/demo-cleanup.mjs can load it directly.
 * Plans and runs are never deleted: finished records are immutable and no role holds DELETE.
 * The only change made is the one the runner already allows, cancelling a run that is stuck.
 */
export const staleAfterMs = 24 * 60 * 60 * 1000;
/** A plan goal that starts like a test or smoke check marks a leftover from manual QA. */
export const qaGoalPattern = /^\s*(?:\[?(?:qa|test|testing|smoke|probe|live check|dummy)\]?)(?![a-z])/i;

export type PlanRow = { id: string; goal: string; status: string; created_at: string | Date };
export type RunRow = { id: string; plan_id: string; status: string; created_at: string | Date };
export type StaleSelection = {
  /** Runs queued, running or planned for more than a day. These are the only rows the cleanup changes. */
  stuckRunIds: string[];
  /** Report only. Finished records stay for the audit trail. */
  cancelledRunIds: string[];
  cancelledPlanIds: string[];
  /** Report only. A proposed plan waits for a human decision, so the four eyes rule stays with people. */
  staleProposedPlanIds: string[];
  qaPlanIds: string[];
  qaRunIds: string[];
};

function ageMs(value: string | Date, now: Date) {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? 0 : now.getTime() - time;
}

/** Pure selection. The same rows and clock always give the same ids, in a stable order. */
export function selectStale(input: { plans: PlanRow[]; runs: RunRow[]; now: Date }): StaleSelection {
  const { plans, runs, now } = input;
  const old = (row: { created_at: string | Date }) => ageMs(row.created_at, now) > staleAfterMs;
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();
  const qaPlans = plans.filter((plan) => qaGoalPattern.test(plan.goal));
  const qaPlanSet = new Set(qaPlans.map((plan) => plan.id));
  return {
    stuckRunIds: ids(runs.filter((run) => ['planned', 'queued', 'running'].includes(run.status) && old(run))),
    cancelledRunIds: ids(runs.filter((run) => run.status === 'cancelled')),
    cancelledPlanIds: ids(plans.filter((plan) => plan.status === 'cancelled')),
    staleProposedPlanIds: ids(plans.filter((plan) => plan.status === 'proposed' && old(plan))),
    qaPlanIds: ids(qaPlans),
    qaRunIds: ids(runs.filter((run) => qaPlanSet.has(run.plan_id))),
  };
}

export function countStale(selection: StaleSelection) {
  return Object.fromEntries(Object.entries(selection).map(([key, value]) => [key, value.length])) as Record<keyof StaleSelection, number>;
}

/** Reads the plans and runs of the workspace set in the current database context. */
export async function loadStaleRows(sql: SqlConnection) {
  const plans = (await sql.query<PlanRow>('SELECT id,goal,status,created_at FROM nazir.plans ORDER BY created_at,id')).rows;
  const runs = (await sql.query<RunRow>('SELECT id,plan_id,status,created_at FROM nazir.runs ORDER BY created_at,id')).rows;
  return { plans, runs };
}

/**
 * Cancels stuck runs and their open conversations, with the same audit events as a member cancel.
 * Call it inside a worker context for one workspace. Running it twice changes nothing the second time.
 */
export async function cancelStuckRuns(sql: SqlConnection, runIds: string[]) {
  let cancelled = 0;
  for (const runId of runIds) {
    const run = (await sql.query("SELECT id FROM nazir.runs WHERE id=$1 AND status IN ('planned','queued','running') FOR UPDATE", [runId])).rows[0];
    if (!run) continue;
    const conversations = await sql.query<{ id: string; model_provider: string | null; model_id: string | null; failover: boolean }>(
      "UPDATE nazir.conversations SET status='cancelled',finished_at=clock_timestamp() WHERE run_id=$1 AND status IN ('planned','queued','running') RETURNING id,model_provider,model_id,failover", [runId]);
    for (const c of conversations.rows) await sql.query("SELECT nazir.append_audit('conversation_finished','conversation',$1,$2)", [c.id, JSON.stringify({ status: 'cancelled', reason: null, provider: c.model_provider, model: c.model_id, failover: c.failover })]);
    await sql.query("UPDATE nazir.runs SET status='cancelled',finished_at=clock_timestamp() WHERE id=$1", [runId]);
    await sql.query("SELECT nazir.append_audit('run_cancelled','run',$1,$2)", [runId, JSON.stringify({ cancelled_by: 'demo_cleanup' })]);
    await sql.query("SELECT nazir.append_audit('run_finished','run',$1,'{\"status\":\"cancelled\"}')", [runId]);
    cancelled += 1;
  }
  return cancelled;
}

/** Selects and cancels the stuck runs of one workspace. */
export async function closeStuckRuns(sql: SqlConnection, now = new Date()) {
  const selection = selectStale({ ...(await loadStaleRows(sql)), now });
  return cancelStuckRuns(sql, selection.stuckRunIds);
}
