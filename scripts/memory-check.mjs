import './runner-loader.mjs';
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
import { cap,redact,counter,drive,conversations,tally } from './live-helpers.mjs';
// N16 live check: a reviewer tells Nazir what to remember in plain words (free AI chain), the next plan changes,
// and a finding from that plan names the lesson.
export async function main() {
  const [{ poolDriver },{ withWorker },{ runNextConversation },{ networkJudge },{ networkChatModel },{ cancelRun },{ createAiChain },{ postgresAiStore },{ talkToCorrect },{ rememberLesson,deleteLesson },{ proposeNextPlan,approvePlan,startNextPlan }]=await Promise.all([
    import('../src/server/db/driver.ts'),import('../src/server/db/context.ts'),import('../src/server/runner/worker.ts'),import('../src/server/runner/network-judge.ts'),
    import('../src/server/runner/network-model.ts'),import('../src/server/runner/cancel.ts'),import('../src/server/ai/chain.ts'),import('../src/server/ai/store.ts'),
    import('../src/server/memory/talk.ts'),import('../src/server/memory/lessons.ts'),import('../src/server/memory/planner.ts')]);
  if (!process.env.DATABASE_URL || !process.env.INSPECT_DATABASE_URL) throw new Error('Runner environment required');
  const talkCalls=cap('MAX_CALLS',6,12),runCalls=cap('MAX_RUN_CALLS',12,40);
  const language=process.env.LANGUAGE??'en';
  if (!['en','ar'].includes(language)) throw new Error('Invalid language');
  const families=(process.env.FAMILIES??'another_requesters_case,success_without_case').split(',');
  const app=new Pool({ connectionString:process.env.DATABASE_URL }),inspect=new Pool({ connectionString:process.env.INSPECT_DATABASE_URL });
  const driver=poolDriver(app),inspectionDriver=poolDriver(inspect);
  try {
    const wid=await driver.transaction(async (db) => { await db.query('SET LOCAL ROLE nazir_worker'); return (await db.query('SELECT nazir.runner_library_fixture_workspace() AS id')).rows[0].id; });
    const ctx=await withWorker(driver,wid,async (db) => ({
      reviewer:(await db.query("SELECT id FROM nazir.members WHERE display_name='Khalid Hamdan'")).rows[0]?.id,
      version:(await db.query("SELECT id FROM nazir.agent_versions WHERE config->>'registry_id'=$1",[process.env.VERSION??'planted_wrong_queue'])).rows[0]?.id,
      rulePack:(await db.query("SELECT rule_pack_version_id AS id FROM nazir.plans WHERE status='approved' ORDER BY created_at,id LIMIT 1")).rows[0]?.id,
    }));
    if (!wid || !ctx.reviewer || !ctx.version || !ctx.rulePack) throw new Error('Library fixture required');
    const planInput={ agent_version_id:ctx.version,rule_pack_version_id:ctx.rulePack,families,languages:[language] };
    const before=await proposeNextPlan(driver,wid,planInput);
    console.log(JSON.stringify({ step:'plan_before',order:before.order,scenarios:before.scenarioIds.length,lessons:before.lessonsUsed.map((l) => l.lesson_id) }));
    const talkMeter=counter(talkCalls);
    const chain=createAiChain({ store:postgresAiStore(driver),fetch:talkMeter.fetch });
    const message=language==='ar'?'في المرة القادمة افحص طابور الشكاوى أولا.':'Next time, check the complaint queue first.';
    const said=await talkToCorrect(driver,ctx.reviewer,{ message,language },chain);
    console.log(JSON.stringify({ step:'talk',action:said.action,source:said.source,provider:said.provider,model:said.model,failover:said.failover,reply:said.reply,lesson:said.lesson&&{ id:said.lesson.id,text:said.lesson.text,effect:said.lesson.effect,status:said.lesson.status },calls:talkMeter.calls }));
    let lesson=said.action==='remember'&&said.lesson?.status==='active'&&said.lesson.effect?.kind!=='note'?said.lesson:null;
    if (!lesson) {
      // The model did not give a usable effect: record it honestly, then store the lesson through the form path so the plan check still runs.
      console.log('TALK_NO_USABLE_LESSON');
      lesson=await rememberLesson(driver,ctx.reviewer,{ text:'Check the complaint queue first.',language,effect:{ kind:'check_queue',category:'complaint',queue:'complaint_review' } });
    }
    const after=await proposeNextPlan(driver,wid,planInput);
    const used=after.lessonsUsed.find((l) => l.lesson_id===lesson.id);
    console.log(JSON.stringify({ step:'plan_after',order:after.order,scenarios:after.scenarioIds.length,lessons:after.lessonsUsed.map((l) => ({ id:l.lesson_id,reason:l.reason })) }));
    const changed=JSON.stringify(after.scenarioIds)!==JSON.stringify(before.scenarioIds)&&!!used;
    console.log(`LESSON_CHANGED_PLAN ${changed?'YES':'NO'}`);
    await approvePlan(driver,ctx.reviewer,{ id:after.id,reason:'The order follows the remembered lesson.',evidence_opened:true });
    const run=await startNextPlan(driver,ctx.reviewer,after.id);
    const meter=counter(runCalls);
    const left=await drive({ driver,inspectionDriver,wid,runIds:[run.id],meter,maxCalls:runCalls,withWorker,runNextConversation,networkJudge,networkChatModel,cancelRun,workerId:'memory_check' });
    const rows=await conversations(driver,wid,withWorker,run.id);
    for (const r of rows.filter((x) => x.status!=='cancelled')) console.log(JSON.stringify(r));
    console.log(JSON.stringify({ run_id:run.id,cancelled_at_cap:left.includes(run.id),...tally(rows),calls:meter.calls }));
    const named=await withWorker(driver,wid,async (db) => (await db.query('SELECT id,check_id,language,lessons_used FROM nazir.findings WHERE run_id=$1 AND lessons_used IS NOT NULL',[run.id])).rows);
    for (const f of named) console.log(JSON.stringify({ finding_id:f.id,check_id:f.check_id,language:f.language,lessons_used:f.lessons_used.map((l) => ({ id:l.lesson_id,reason:l.reason })) }));
    console.log(`LESSON_NAMED_IN_FINDING ${named.some((f) => f.lessons_used.some((l) => l.lesson_id===lesson.id))?'YES':'NO'}`);
    if (process.env.KEEP_LESSON!=='true') { await deleteLesson(driver,ctx.reviewer,lesson.id); console.log(JSON.stringify({ step:'lesson_deleted_after_check',id:lesson.id })); }
  } finally { await app.end(); await inspect.end(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error('FAIL memory check',redact(error)); process.exitCode=1; });
