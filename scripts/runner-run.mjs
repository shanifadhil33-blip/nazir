import './runner-loader.mjs';
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
// The loader hooks must be registered before any TypeScript module is resolved, so TS modules load dynamically in main.
function cap(name,fallback,max) {
  const value=Number(process.env[name]??fallback);
  if (!Number.isSafeInteger(value) || value<1 || value>max) throw new Error('Invalid cap');
  return value;
}
export async function main() {
  const [{ poolDriver }, { withWorker }, { enqueueRun }, { runNextConversation }, { networkJudge }, { networkChatModel }] = await Promise.all([
    import('../src/server/db/driver.ts'), import('../src/server/db/context.ts'), import('../src/server/runner/enqueue.ts'),
    import('../src/server/runner/worker.ts'), import('../src/server/runner/network-judge.ts'), import('../src/server/runner/network-model.ts'),
  ]);
  // Fault injection for live failure paths: providers listed here fail as forced_down without a network call.
  const forcedDown=new Set((process.env.RUNNER_FORCE_DOWN??'').split(',').map((id) => id.trim()).filter(Boolean));
  if (!process.env.DATABASE_URL || !process.env.INSPECT_DATABASE_URL || !process.env.IDEMPOTENCY_KEY) throw new Error('Runner environment required');
  const maxConversations=cap('MAX_CONVERSATIONS',2,6),maxCalls=cap('MAX_CALLS',24,60);
  const version=process.env.VERSION??'baseline',languages=(process.env.LANGUAGES??'en,ar').split(',');
  if (!languages.length || languages.some((l) => !['en','ar'].includes(l)) || new Set(languages).size!==languages.length) throw new Error('Invalid languages');
  const app=new Pool({ connectionString:process.env.DATABASE_URL }),inspect=new Pool({ connectionString:process.env.INSPECT_DATABASE_URL });
  const driver=poolDriver(app),inspectionDriver=poolDriver(inspect);
  let calls=0;
  try {
    const wid=process.env.WORKSPACE_ID ?? await driver.transaction(async (db) => { await db.query('SET LOCAL ROLE nazir_worker'); return (await db.query(process.env.RUN_WORKSPACE==='library'?'SELECT nazir.runner_library_fixture_workspace() AS id':'SELECT nazir.runner_fixture_workspace() AS id')).rows[0].id; });
    if (!wid) throw new Error('Runner fixture required');
    const input=await withWorker(driver,wid,async (db) => {
      const plan=(await db.query("SELECT id FROM nazir.plans WHERE status='approved' ORDER BY created_at,id LIMIT 1")).rows[0];
      const agent=(await db.query("SELECT id FROM nazir.agent_versions WHERE config->>'registry_id'=$1",[version])).rows[0];
      const keys=process.env.RUN_SCENARIOS?.split(',').map((s)=>s.trim()).filter(Boolean);
      const scenarios=(await db.query("SELECT id FROM nazir.scenarios WHERE status='approved' AND language=ANY($1::text[]) AND ($2::text[] IS NULL OR stable_key=ANY($2::text[])) ORDER BY stable_key,language",[languages,keys??null])).rows;
      if (!plan || !agent || !scenarios.length || (keys && scenarios.length!==keys.length)) throw new Error('Fixture required');
      return { workspaceId:wid,planId:plan.id,agentVersionId:agent.id,scenarioIds:scenarios.map((s) => s.id),repeats:1,idempotencyKey:process.env.IDEMPOTENCY_KEY,recordsOnly:process.env.RECORDS_ONLY==='true'?true:process.env.RECORDS_ONLY==='false'?false:undefined };
    });
    const run=await enqueueRun(driver,input);
    const fetch=async (...args) => { if (calls>=maxCalls) throw new Error('Process cap reached'); calls++; return globalThis.fetch(...args); };
    const state=() => withWorker(driver,wid,async (db) => (await db.query('SELECT status FROM nazir.runs WHERE id=$1',[run.id])).rows[0].status);
    for (let n=0;n<maxConversations && calls<maxCalls;n++) {
      if (['passed','failed','inconclusive','cancelled'].includes(await state())) break;
      const result=await runNextConversation({ driver,inspectionDriver,workerId:'runner_cli',judgeFactory:(context) => networkJudge(driver,context,{fetch,forcedDown}),chatModelFactory:(context) => networkChatModel(driver,context,{ fetch,forcedDown }) });
      if (!result) break;
    }
    const output=await withWorker(driver,wid,async (db) => (await db.query(`SELECT c.id,c.status,c.inconclusive_reason AS reason,c.last_error,c.result_summary,c.model_provider AS provider,c.model_id AS model,c.failover,c.sandbox_tenant AS tenant,
      (SELECT reading->'cases' FROM nazir.state_readings s WHERE s.conversation_id=c.id ORDER BY s.created_at DESC,s.id DESC LIMIT 1) AS cases
      FROM nazir.conversations c WHERE c.run_id=$1 ORDER BY c.created_at,c.id`,[run.id])).rows);
    for (const { result_summary,...c } of output) {
      const results=result_summary?.records ?? (Array.isArray(result_summary?.results)?result_summary.results:result_summary?.results?.records??[]);
      const semantic=result_summary?.semantic ?? result_summary?.results?.semantic;
      if(semantic) console.log(JSON.stringify({conversation_id:c.id,semantic:{status:semantic.status,issue:semantic.issue,span:semantic.span,provider:semantic.provider,model:semantic.model}}));
      for (const check of results) console.log(JSON.stringify({ conversation_id:c.id,id:check.id,status:check.status,expected:check.evidence.expected,observed:check.evidence.observed }));
      const said=results.find((check) => check.id==='reply_matches_record')?.evidence?.said;
      if (said) console.log(JSON.stringify({ conversation_id:c.id,agent_said:String(said).slice(0,240) }));
      console.log(JSON.stringify({ ...c,cases:(c.cases??[]).map((r) => ({ reference:r.reference,queue:r.queue,escalation_queue:r.escalation?.queue??null })) }));
    }
    console.log(JSON.stringify({ run_id:run.id,status:await state(),calls }));
  } finally { await app.end(); await inspect.end(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error('FAIL runner run',String(error?.message??'').replace(/postgres(ql)?:\/\/\S+/g,'[address]').replace(/Bearer\s+\S+/g,'Bearer [hidden]').slice(0,200)); process.exitCode=1; });
