// Shared pieces for the N15 to N17 live checks. No secrets are printed: errors are redacted before output.
export function cap(name,fallback,max) {
  const value=Number(process.env[name]??fallback);
  if (!Number.isSafeInteger(value) || value<1 || value>max) throw new Error('Invalid cap');
  return value;
}
export const redact=(error) => String(error?.message??error??'').replace(/postgres(ql)?:\/\/\S+/g,'[address]').replace(/Bearer\s+\S+/g,'Bearer [hidden]').replace(/(sk|gsk|nvapi|AIza)[-_A-Za-z0-9]{8,}/g,'[key]').slice(0,200);
export function counter(max) {
  const state={ calls:0 };
  state.fetch=async (...args) => { if (state.calls>=max) throw new Error('Process cap reached'); state.calls++; return globalThis.fetch(...args); };
  return state;
}
/** Runs queued conversations of the given runs until they finish or the call cap is reached. */
export async function drive({ driver,inspectionDriver,wid,runIds,meter,maxCalls,withWorker,runNextConversation,networkJudge,networkChatModel,cancelRun,workerId }) {
  const open=async () => withWorker(driver,wid,async (db) => (await db.query("SELECT count(*)::int AS n FROM nazir.runs WHERE id=ANY($1::uuid[]) AND status IN ('queued','running')",[runIds])).rows[0].n);
  while (meter.calls<maxCalls && await open()>0) {
    const result=await runNextConversation({ driver,inspectionDriver,workerId,judgeFactory:(context) => networkJudge(driver,context,{ fetch:meter.fetch }),chatModelFactory:(context) => networkChatModel(driver,context,{ fetch:meter.fetch }) });
    if (!result) break;
  }
  // Anything left at the cap is cancelled, so it never blocks a later run. Cancelled is never a pass.
  const left=[];
  for (const id of runIds) {
    const status=await withWorker(driver,wid,async (db) => (await db.query('SELECT status FROM nazir.runs WHERE id=$1',[id])).rows[0].status);
    if (['queued','running'].includes(status) && process.env.CANCEL_REST!=='false') { await cancelRun(driver,wid,id); left.push(id); }
  }
  return left;
}
export async function conversations(driver,wid,withWorker,runId) {
  return withWorker(driver,wid,async (db) => (await db.query(`SELECT c.id,c.idempotency_key AS key,c.status,c.inconclusive_reason AS reason,c.model_provider AS provider,c.model_id AS model,c.failover,s.family,s.split,
    (SELECT array_agg(f.check_id ORDER BY f.check_id) FROM nazir.findings f WHERE f.conversation_id=c.id) AS findings
    FROM nazir.conversations c JOIN nazir.scenarios s ON s.id=c.scenario_id WHERE c.run_id=$1 ORDER BY c.created_at,c.id`,[runId])).rows);
}
export function tally(rows) {
  const t={ total:rows.length,passed:0,failed:0,inconclusive:0,cancelled:0,queued:0 };
  for (const r of rows) { if (r.status in t) t[r.status]++; else t.queued++; }
  return t;
}
