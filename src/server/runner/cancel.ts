import 'server-only';
import { withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
export async function cancelRun(driver: TransactionDriver,workspaceId: string,runId: string) {
  return withWorker(driver,workspaceId,async (db) => {
    const run = (await db.query("SELECT id FROM nazir.runs WHERE id=$1 AND status IN ('planned','queued','running') FOR UPDATE",[runId])).rows[0];
    if (!run) return false;
    const cancelled=await db.query<{ id: string; model_provider: string | null; model_id: string | null; failover: boolean }>("UPDATE nazir.conversations SET status='cancelled',finished_at=clock_timestamp() WHERE run_id=$1 AND status IN ('planned','queued','running') RETURNING id,model_provider,model_id,failover",[runId]);
    for (const c of cancelled.rows) await db.query("SELECT nazir.append_audit('conversation_finished','conversation',$1,$2)",[c.id,JSON.stringify({ status:'cancelled',reason:null,provider:c.model_provider,model:c.model_id,failover:c.failover })]);
    await db.query("UPDATE nazir.runs SET status='cancelled',finished_at=clock_timestamp() WHERE id=$1",[runId]);
    await db.query("SELECT nazir.append_audit('run_cancelled','run',$1,'{}')",[runId]);
    await db.query("SELECT nazir.append_audit('run_finished','run',$1,'{\"status\":\"cancelled\"}')",[runId]);
    return true;
  });
}
