import './runner-loader.mjs';
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
import { cap,redact,counter } from './live-helpers.mjs';
// N17 live check: compare two finished runs with denominators, regressions, inconclusive counted apart, and paired results.
export async function main() {
  const [{ poolDriver },{ withWorker },{ compareRuns },{ createAiChain },{ postgresAiStore },{ judgePair },{ clauseText }]=await Promise.all([
    import('../src/server/db/driver.ts'),import('../src/server/db/context.ts'),import('../src/server/compare/compare.ts'),import('../src/server/ai/chain.ts'),import('../src/server/ai/store.ts'),import('../src/server/judge/pair.ts'),import('../src/server/judge/rubric.ts')]);
  if (!process.env.DATABASE_URL) throw new Error('Database required');
  const app=new Pool({ connectionString:process.env.DATABASE_URL }),driver=poolDriver(app);
  try {
    const wid=await driver.transaction(async (db) => { await db.query('SET LOCAL ROLE nazir_worker'); return (await db.query('SELECT nazir.runner_library_fixture_workspace() AS id')).rows[0].id; });
    const ctx=await withWorker(driver,wid,async (db) => {
      const reviewer=(await db.query("SELECT id FROM nazir.members WHERE display_name='Khalid Hamdan'")).rows[0]?.id;
      let a=process.env.RUN_A,b=process.env.RUN_B;
      if (process.env.PROPOSAL_ID) {
        // Old version: the run the finding came from. New version: the retest run of the approved repair.
        a=(await db.query('SELECT f.run_id AS id FROM nazir.proposals p JOIN nazir.findings f ON f.id=p.finding_id WHERE p.id=$1',[process.env.PROPOSAL_ID])).rows[0]?.id;
        b=(await db.query("SELECT r.id FROM nazir.runs r JOIN nazir.plans p ON p.id=r.plan_id WHERE p.stop_rules->>'retest_of_proposal'=$1 AND p.stop_rules->>'set'=$2 ORDER BY r.created_at DESC LIMIT 1",[process.env.PROPOSAL_ID,process.env.RUN_SET??'retest'])).rows[0]?.id;
      }
      return { reviewer,a,b };
    });
    if (!ctx.reviewer || !ctx.a || !ctx.b) throw new Error('Two runs required');
    let pairJudge;
    const judgePairs=process.env.JUDGE_PAIRS==='true',meter=counter(cap('MAX_CALLS',10,20));
    if (judgePairs) {
      const chain=createAiChain({ store:postgresAiStore(driver),fetch:meter.fetch });
      // Service evidence for both replies: the approved rule clause and expected state of the frozen scenario (never version names).
      // Without it the judge only sees reply text and prefers the more detailed reply even when it names the wrong queue.
      const context=async (key) => withWorker(driver,wid,async (db) => {
        const s=(await db.query("SELECT language,source_clause,expected_state FROM nazir.scenarios WHERE stable_key=$1 AND status='approved' ORDER BY version DESC LIMIT 1",[key])).rows[0];
        if (!s) return '';
        const clause=clauseText(s.source_clause);
        return JSON.stringify({ rule:s.language==='ar'?{ ar:clause.ar,en:clause.en }:{ en:clause.en },expectedState:s.expected_state });
      });
      pairJudge=async ({ a,b,seed,pair }) => { try { return await judgePair({ chain,a,b,seed,context:await context(pair.scenario_key),swapCheck:true,agentFamilies:['nvidia_nemotron'],task:'test_run' }); } catch { return { better:'uncertain' }; } };
    }
    const result=await compareRuns(driver,ctx.reviewer,{ runA:ctx.a,runB:ctx.b,pairJudge,maxJudgePairs:Number(process.env.MAX_JUDGE_PAIRS??4) });
    console.log(JSON.stringify({ comparison_id:result.id,summary_hash:result.summary_hash,run_a:ctx.a,run_b:ctx.b }));
    console.log(JSON.stringify({ totals:result.summary.totals,byLanguage:result.summary.byLanguage,unpaired:result.summary.unpaired,regressions:result.summary.regressions,failoverPairs:result.summary.failoverPairs,settingsDiffer:result.summary.settingsDiffer,judgedPairs:result.summary.judgedPairs??null }));
    console.log(JSON.stringify({ sentences:result.summary.sentences }));
    for (const p of result.pairs) console.log(JSON.stringify({ key:p.key,language:p.language,family:p.family,class:p.class,a:p.a&&{ status:p.a.status,failing:p.a.failing_checks,failover:p.a.failover },b:p.b&&{ status:p.b.status,failing:p.b.failing_checks,failover:p.b.failover },better:p.better??null }));
    console.log(JSON.stringify({ parity:result.parity,calls:meter.calls }));
  } finally { await app.end(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error('FAIL compare versions',redact(error)); process.exitCode=1; });
