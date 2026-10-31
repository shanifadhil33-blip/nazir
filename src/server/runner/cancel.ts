import 'server-only';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { withMember, withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, NotFound, errorLines } from '../http/errors';
export async function cancelRun(driver: TransactionDriver,workspaceId: string,runId: string,by?: string) {
  return withWorker(driver,workspaceId,async (db) => {
    const run = (await db.query("SELECT id FROM nazir.runs WHERE id=$1 AND status IN ('planned','queued','running') FOR UPDATE",[runId])).rows[0];
    if (!run) return false;
    const cancelled=await db.query<{ id: string; model_provider: string | null; model_id: string | null; failover: boolean }>("UPDATE nazir.conversations SET status='cancelled',finished_at=clock_timestamp() WHERE run_id=$1 AND status IN ('planned','queued','running') RETURNING id,model_provider,model_id,failover",[runId]);
    for (const c of cancelled.rows) await db.query("SELECT nazir.append_audit('conversation_finished','conversation',$1,$2)",[c.id,JSON.stringify({ status:'cancelled',reason:null,provider:c.model_provider,model:c.model_id,failover:c.failover })]);
    await db.query("UPDATE nazir.runs SET status='cancelled',finished_at=clock_timestamp() WHERE id=$1",[runId]);
    await db.query("SELECT nazir.append_audit('run_cancelled','run',$1,$2)",[runId,JSON.stringify(by ? { cancelled_by:by } : {})]);
    await db.query("SELECT nazir.append_audit('run_finished','run',$1,'{\"status\":\"cancelled\"}')",[runId]);
    return true;
  });
}

const id = z.uuid();
const notCancellable = () => new Coded(409,'not_cancellable',errorLines.not_cancellable.en);
export type CancelResult = { id: string; status: 'cancelled'; changed: boolean };

/** An owner or quality reviewer cancels a queued or running run. Cancelling again returns the same result. */
export async function cancelRunAsMember(driver: TransactionDriver,memberId: string,runId: unknown): Promise<CancelResult> {
  const rid = id.parse(runId).toLowerCase();
  const found = await withMember(driver,memberId,async (sql) => {
    await requireRole(sql,'plan.approve');
    return (await sql.query<{ workspace_id: string; status: string }>('SELECT workspace_id,status FROM nazir.runs WHERE id=$1 AND workspace_id=nazir.current_workspace_id()',[rid])).rows[0];
  });
  if (!found) throw new NotFound();
  if (found.status==='cancelled') return { id:rid,status:'cancelled',changed:false };
  if (!['planned','queued','running'].includes(found.status)) throw notCancellable();
  const changed = await cancelRun(driver,found.workspace_id,rid,memberId);
  if (!changed) {
    // Another request finished or cancelled it first.
    const now = (await withWorker(driver,found.workspace_id,(sql) => sql.query<{ status: string }>('SELECT status FROM nazir.runs WHERE id=$1',[rid]))).rows[0]?.status;
    if (now!=='cancelled') throw notCancellable();
  }
  return { id:rid,status:'cancelled',changed };
}

/** An owner or quality reviewer cancels a proposed or approved plan. Its unfinished runs are cancelled too. */
export async function cancelPlan(driver: TransactionDriver,memberId: string,planId: unknown): Promise<CancelResult & { runs: string[] }> {
  const pid = id.parse(planId).toLowerCase();
  const result = await withMember(driver,memberId,async (sql) => {
    await requireRole(sql,'plan.approve');
    const plan = (await sql.query<{ workspace_id: string; status: string }>('SELECT workspace_id,status FROM nazir.plans WHERE id=$1 FOR UPDATE',[pid])).rows[0];
    if (!plan) throw new NotFound();
    if (plan.status==='cancelled') return { workspaceId:plan.workspace_id,changed:false };
    if (plan.status!=='proposed' && plan.status!=='approved') throw notCancellable();
    await sql.query("UPDATE nazir.plans SET status='cancelled' WHERE id=$1 AND status IN ('proposed','approved')",[pid]);
    await sql.query("SELECT nazir.append_audit('plan.cancelled','plan',$1,$2)",[pid,JSON.stringify({ from:plan.status })]);
    return { workspaceId:plan.workspace_id,changed:true };
  });
  const open = (await withWorker(driver,result.workspaceId,(sql) => sql.query<{ id: string }>("SELECT id FROM nazir.runs WHERE plan_id=$1 AND status IN ('planned','queued','running') ORDER BY created_at,id",[pid]))).rows;
  for (const run of open) await cancelRun(driver,result.workspaceId,run.id,memberId);
  return { id:pid,status:'cancelled',changed:result.changed,runs:open.map((r) => r.id) };
}
