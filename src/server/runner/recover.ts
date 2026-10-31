import 'server-only';
import { withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { errorLines } from '../http/errors';
import { applyBoundedStop } from '../planner/stop';

export const stalledReason = 'step_stalled';
type Stale = { id: string; attempt: number; max_attempts: number; last_error: string | null; model_provider: string | null; model_id: string | null; failover: boolean };

/**
 * A step that died (the request hit its time limit, or the database dropped mid step) leaves its conversation running,
 * and its heartbeat stops. Once the lease runs out it is put back in the queue once, on a fresh tenant. If it stalls
 * again, or has no attempts left, it ends inconclusive with step_stalled and the run is finished when nothing else is open.
 * Only running conversations are touched, so a finished case is never run again.
 */
export async function recoverStale(driver: TransactionDriver, workspaceId: string, runId: string) {
  return withWorker(driver, workspaceId, async (db) => {
    const run = (await db.query("SELECT id FROM nazir.runs WHERE id=$1 AND status IN ('queued','running') FOR UPDATE", [runId])).rows[0];
    if (!run) return { requeued: 0, ended: 0 };
    const stale = (await db.query<Stale>(`SELECT id,attempt,max_attempts,last_error,model_provider,model_id,failover FROM nazir.conversations
      WHERE run_id=$1 AND status='running' AND lease_expires_at<=clock_timestamp() ORDER BY created_at,id FOR UPDATE`, [runId])).rows;
    let requeued = 0, ended = 0;
    for (const c of stale) {
      const payload = { run_id: runId, attempt: c.attempt, status: 'inconclusive', reason: stalledReason, provider: c.model_provider, model: c.model_id, failover: c.failover };
      if (c.last_error === stalledReason || c.attempt >= c.max_attempts) {
        const done = await db.query(`UPDATE nazir.conversations SET status='inconclusive',inconclusive_reason=$2,last_error=$2,finished_at=clock_timestamp(),result_summary=$3::jsonb,lease_owner=NULL,lease_expires_at=NULL
          WHERE id=$1 AND status='running' RETURNING id`, [c.id, stalledReason, JSON.stringify({ stalled: errorLines.step_stalled, results: {} })]);
        if (!done.rows.length) continue;
        await db.query("SELECT nazir.append_audit('conversation_finished','conversation',$1,$2)", [c.id, JSON.stringify(payload)]);
        ended++;
      } else {
        const back = await db.query(`UPDATE nazir.conversations SET status='queued',inconclusive_reason=$2,last_error=$2,available_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL
          WHERE id=$1 AND status='running' RETURNING id`, [c.id, stalledReason]);
        if (!back.rows.length) continue;
        await db.query("SELECT nazir.append_audit('conversation_retried','conversation',$1,$2)", [c.id, JSON.stringify(payload)]);
        requeued++;
      }
    }
    if (ended) {
      await applyBoundedStop(db, runId);
      await db.query('SELECT nazir.runner_aggregate($1)', [runId]);
    }
    return { requeued, ended };
  });
}
