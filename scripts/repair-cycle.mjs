import './runner-loader.mjs';
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
import { cap,redact,counter,drive,conversations,tally } from './live-helpers.mjs';
// N15 live check: a supplier proposes, a reviewer approves with a reason, a frozen repaired version is created,
// the affected, normal, retry and hidden cases rerun, and the old records stay byte for byte the same.
export async function main() {
  const [{ poolDriver },{ withWorker },{ runNextConversation },{ networkJudge },{ networkChatModel },{ cancelRun },{ submitRepair,decideRepair,startRetest },{ evidenceDigest }]=await Promise.all([
    import('../src/server/db/driver.ts'),import('../src/server/db/context.ts'),import('../src/server/runner/worker.ts'),import('../src/server/runner/network-judge.ts'),
    import('../src/server/runner/network-model.ts'),import('../src/server/runner/cancel.ts'),import('../src/server/repair/proposals.ts'),import('../src/server/repair/evidence-digest.ts')]);
  if (!process.env.DATABASE_URL || !process.env.INSPECT_DATABASE_URL) throw new Error('Runner environment required');
  const maxCalls=cap('MAX_CALLS',40,80),set=process.env.RUN_SET??'retest';
  if (!['retest','suite','both'].includes(set)) throw new Error('Invalid set');
  const sets=set==='both'?['retest','suite']:[set],recordsOnly=process.env.RECORDS_ONLY==='true';
  const app=new Pool({ connectionString:process.env.DATABASE_URL }),inspect=new Pool({ connectionString:process.env.INSPECT_DATABASE_URL });
  const driver=poolDriver(app),inspectionDriver=poolDriver(inspect),meter=counter(maxCalls);
  try {
    const wid=await driver.transaction(async (db) => { await db.query('SET LOCAL ROLE nazir_worker'); return (await db.query('SELECT nazir.runner_library_fixture_workspace() AS id')).rows[0].id; });
    if (!wid) throw new Error('Library fixture required');
    const ctx=await withWorker(driver,wid,async (db) => {
      const member=async (name) => (await db.query('SELECT id FROM nazir.members WHERE display_name=$1',[name])).rows[0]?.id;
      const finding=(await db.query(`SELECT f.id,f.run_id FROM nazir.findings f JOIN nazir.agent_versions v ON v.id=f.agent_version_id
        WHERE ($1::uuid IS NULL OR f.id=$1) AND v.config->>'registry_id'='planted_wrong_queue' AND f.check_id='right_queue' AND f.status='open' ORDER BY f.created_at DESC,f.id LIMIT 1`,[process.env.FINDING_ID??null])).rows[0];
      return { supplier:await member('Yusuf Rahman'),reviewer:await member('Khalid Hamdan'),finding };
    });
    if (!ctx.supplier || !ctx.reviewer || !ctx.finding) throw new Error('Supplier, reviewer and an open planted queue finding are required');
    const before=(await evidenceDigest(driver,wid,ctx.finding.run_id)).digest;
    let proposalId=process.env.PROPOSAL_ID,decided=null;
    if (!proposalId) {
      const proposal=await submitRepair(driver,ctx.supplier,{ finding_id:ctx.finding.id,evidence:'Stored case queue differs from the approved routing map while the reply said success.' });
      console.log(JSON.stringify({ step:'proposed',proposal_id:proposal.id,status:proposal.status,patch:proposal.patch,title:proposal.title }));
      proposalId=proposal.id;
      decided=await decideRepair(driver,ctx.reviewer,{ id:proposalId,decision:'approve',reason:'Read the receipts and the stored queue; the patch restores the approved routing map.',evidence_opened:true });
      console.log(JSON.stringify({ step:'approved',status:decided.status,version_id:decided.version_id,affected:decided.retest.affected.length,normal:decided.retest.normal.length,retry:decided.retest.retry.length,hidden:decided.retest.hidden.length,suite:decided.retest.suite.length }));
    }
    const runs=await startRetest(driver,ctx.reviewer,{ proposalId,sets,recordsOnly });
    const left=await drive({ driver,inspectionDriver,wid,runIds:Object.values(runs),meter,maxCalls,withWorker,runNextConversation,networkJudge,networkChatModel,cancelRun,workerId:'repair_cycle' });
    for (const [name,id] of Object.entries(runs)) {
      const rows=await conversations(driver,wid,withWorker,id);
      for (const r of rows) console.log(JSON.stringify({ set:name,...r }));
      console.log(JSON.stringify({ set:name,run_id:id,cancelled_at_cap:left.includes(id),...tally(rows) }));
    }
    const after=(await evidenceDigest(driver,wid,ctx.finding.run_id)).digest;
    console.log(`OLD_RECORDS ${before===after?'SAME':'CHANGED'} ${before.slice(0,16)} ${after.slice(0,16)}`);
    console.log(JSON.stringify({ proposal_id:proposalId,calls:meter.calls,max_calls:maxCalls }));
    if (before!==after) process.exitCode=1;
  } finally { await app.end(); await inspect.end(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error('FAIL repair cycle',redact(error)); process.exitCode=1; });
