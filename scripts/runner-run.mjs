import './runner-loader.mjs';
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
import { poolDriver } from '../src/server/db/driver.ts';
import { withWorker } from '../src/server/db/context.ts';
import { enqueueRun } from '../src/server/runner/enqueue.ts';
import { runNextConversation } from '../src/server/runner/worker.ts';
import { networkChatModel } from '../src/server/runner/network-model.ts';
function cap(name,fallback,max) {
  const value=Number(process.env[name]??fallback);
  if (!Number.isSafeInteger(value) || value<1 || value>max) throw new Error('Invalid cap');
  return value;
}
export async function main() {
  if (!process.env.DATABASE_URL || !process.env.INSPECT_DATABASE_URL || !process.env.IDEMPOTENCY_KEY) throw new Error('Runner environment required');
  const maxConversations=cap('MAX_CONVERSATIONS',2,6),maxCalls=cap('MAX_CALLS',24,60);
  const version=process.env.VERSION??'baseline',languages=(process.env.LANGUAGES??'en,ar').split(',');
  if (!languages.length || languages.some((l) => !['en','ar'].includes(l)) || new Set(languages).size!==languages.length) throw new Error('Invalid languages');
  const app=new Pool({ connectionString:process.env.DATABASE_URL }),inspect=new Pool({ connectionString:process.env.INSPECT_DATABASE_URL });
  const driver=poolDriver(app),inspectionDriver=poolDriver(inspect);
  let calls=0;
  try {
    const wid=await driver.transaction(async (db) => { await db.query('SET LOCAL ROLE nazir_worker'); return (await db.query('SELECT nazir.runner_fixture_workspace() AS id')).rows[0].id; });
    if (!wid) throw new Error('Runner fixture required');
    const input=await withWorker(driver,wid,async (db) => {
      const plan=(await db.query("SELECT id FROM nazir.plans WHERE status='approved' ORDER BY created_at,id LIMIT 1")).rows[0];
      const agent=(await db.query("SELECT id FROM nazir.agent_versions WHERE config->>'registry_id'=$1",[version])).rows[0];
      const scenarios=(await db.query("SELECT id FROM nazir.scenarios WHERE status='approved' AND language=ANY($1::text[]) ORDER BY language",[languages])).rows;
      if (!plan || !agent || scenarios.length!==languages.length) throw new Error('Fixture required');
      return { workspaceId:wid,planId:plan.id,agentVersionId:agent.id,scenarioIds:scenarios.map((s) => s.id),repeats:1,idempotencyKey:process.env.IDEMPOTENCY_KEY };
    });
    const run=await enqueueRun(driver,input);
    const fetch=async (...args) => { if (calls>=maxCalls) throw new Error('Process cap reached'); calls++; return globalThis.fetch(...args); };
    const state=() => withWorker(driver,wid,async (db) => (await db.query('SELECT status FROM nazir.runs WHERE id=$1',[run.id])).rows[0].status);
    for (let n=0;n<maxConversations && calls<maxCalls;n++) {
      if (['passed','failed','inconclusive','cancelled'].includes(await state())) break;
      const result=await runNextConversation({ driver,inspectionDriver,workerId:'runner_cli',chatModelFactory:(context) => networkChatModel(driver,context,{ fetch }) });
      if (!result) break;
    }
    const output=await withWorker(driver,wid,async (db) => (await db.query(`SELECT c.id,c.status,c.inconclusive_reason AS reason,c.last_error,c.model_provider AS provider,c.model_id AS model,c.failover,c.sandbox_tenant AS tenant,
      (SELECT reading->'cases' FROM nazir.state_readings s WHERE s.conversation_id=c.id ORDER BY s.created_at DESC,s.id DESC LIMIT 1) AS cases
      FROM nazir.conversations c WHERE c.run_id=$1 ORDER BY c.created_at,c.id`,[run.id])).rows);
    for (const c of output) console.log(JSON.stringify({ ...c,cases:(c.cases??[]).map((r) => ({ reference:r.reference,queue:r.queue,escalation_queue:r.escalation?.queue??null })) }));
    console.log(JSON.stringify({ run_id:run.id,status:await state(),calls }));
  } finally { await app.end(); await inspect.end(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('FAIL runner run'); process.exitCode=1; });
