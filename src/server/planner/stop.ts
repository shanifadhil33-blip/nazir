import 'server-only';
import type { SqlConnection } from '../db/driver';

type StopRules = { set?: string; size?: string; stop?: { failure_streak?: number } };

/** After a bounded run conversation, stop the rest when the failure streak or the call ceiling is reached. */
export async function applyBoundedStop(db: SqlConnection, runId: string) {
  const row = (await db.query<{ stop_rules: StopRules; calls_used: number; calls_budget: number }>(`SELECT p.stop_rules,r.calls_used,r.calls_budget FROM nazir.runs r
    JOIN nazir.plans p ON p.id=r.plan_id AND p.workspace_id=r.workspace_id WHERE r.id=$1`, [runId])).rows[0];
  if (!row || row.stop_rules?.set !== 'bounded') return 0;
  const callsUsed = Number(row.calls_used);
  const callsBudget = Number(row.calls_budget);
  // A Quick check always finishes its 16 tests. Its tests also run 3 times each, so a streak counts different tests, never repeats of one.
  const limit = row.stop_rules.size === 'quick' ? 0 : row.stop_rules.stop?.failure_streak ?? 0;
  const finished = (await db.query<{ status: string; scenario_id: string }>(`SELECT status,scenario_id FROM nazir.conversations WHERE run_id=$1 AND status IN ('passed','failed','inconclusive','cancelled') ORDER BY finished_at DESC NULLS LAST,id DESC`, [runId])).rows;
  let streak = 0;
  let last = '';
  for (const conversation of finished) {
    if (conversation.status !== 'failed') break;
    if (conversation.scenario_id !== last) streak += 1;
    last = conversation.scenario_id;
  }
  if (!((limit > 0 && streak >= limit) || callsUsed >= callsBudget)) return 0;
  const cancelled = (await db.query<{ id: string }>(`UPDATE nazir.conversations SET status='cancelled',finished_at=clock_timestamp() WHERE run_id=$1 AND status IN ('planned','queued') RETURNING id`, [runId])).rows;
  for (const conversation of cancelled) await db.query("SELECT nazir.append_audit('conversation_finished','conversation',$1,'{\"status\":\"cancelled\",\"reason\":\"stop_rule\"}')", [conversation.id]);
  return cancelled.length;
}
