import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAiChain } from '../../src/server/ai/chain';
import { memoryAiStore } from '../../src/server/ai/store';
import { judgeReply } from '../../src/server/judge/judge';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { runNextConversation } from '../../src/server/runner/worker';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { fixture, journey } from '../runner/helpers';

const prompt='Private judge prompt نص مراجعة خاص';
const key='sk-fictional-oct30-key';
const reply='Request received. تم استلام الطلب.';
function setup(failures: number, advanceMs=0) {
  let clock=0;
  const now=()=>clock;
  const fetch=vi.fn<typeof globalThis.fetch>(async():Promise<Response>=> {
    clock+=advanceMs;
    return fetch.mock.calls.length<=failures ? new Response(key+prompt,{status:503}) : Response.json({choices:[{message:{content:JSON.stringify({verdict:'supported',issue:'none',evidence_span:reply,reason:'Supported. تدعمه الأدلة.'})}}]});
  });
  const chain=createAiChain({store:memoryAiStore(now),now,sleep:async ms=>{clock+=ms;},env:{GEMINI_API_KEY:key},fetch});
  const run=(deadlineMs=90000)=>judgeReply({chain,input:{prompt,reply},agentFamilies:['nvidia_nemotron'],seed:'oct30',deadlineMs});
  return {run,fetch};
}
it('retries the full judge chain once and recovers without using the agent family',async()=> {
  const s=setup(2);
  const result=await s.run();
  expect(result.status).toBe('supported');
  expect(s.fetch).toHaveBeenCalledTimes(3);
  expect(result.attempts.filter(a=>a.provider==='gemini')).toHaveLength(2);
  expect(result.attempts.every(a=>a.family!=='nvidia_nemotron')).toBe(true);
});
it('stops after exactly two full passes and retains both sets of attempts',async()=> {
  const s=setup(Infinity);
  const result=await s.run();
  expect(result.status).toBe('unavailable');
  expect(s.fetch).toHaveBeenCalledTimes(4);
  expect(result.attempts.filter(a=>a.provider==='gemini')).toHaveLength(2);
});
it.each([29999,30000,44999,45000])('uses provider judge timeouts to gate retry with %i ms remaining',async remaining=> {
  // Gemini is excluded. Requesty needs 45 s for a judge, not its 12 s agent timeout.
  let clock=0;
  const now=()=>clock;
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>{clock+=12000;return new Response('',{status:503});});
  const chain=createAiChain({store:memoryAiStore(now),now,sleep:async ms=>{clock+=ms;},env:{REQUESTY_API_KEY:key},fetch});
  const result=await judgeReply({chain,input:{prompt,reply},agentFamilies:['google_gemini','nvidia_nemotron','openai_gpt_oss','zhipu_glm'],seed:'timeout',deadlineMs:12000+remaining});
  expect(result.status).toBe('unavailable');
  expect(fetch).toHaveBeenCalledTimes(remaining>=45000?2:1);
});
it('does not reset the original deadline between passes',async()=> {
  const s=setup(Infinity,20000);
  const result=await s.run(45000);
  expect(s.fetch).toHaveBeenCalledTimes(2);
  expect(result.attempts.filter(a=>a.provider==='gemini')).toHaveLength(1);
});
it.each(['supported','contradicted','uncertain'] as const)('never retries after a real %s verdict',async verdict=> {
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>Response.json({choices:[{message:{content:JSON.stringify({verdict,issue:verdict==='contradicted'?'false_claim':'none',evidence_span:reply,reason:'Evidence. دليل.'})}}]}));
  const chain=createAiChain({store:memoryAiStore(),env:{GEMINI_API_KEY:key},fetch});
  expect((await judgeReply({chain,input:{prompt,reply},agentFamilies:['nvidia_nemotron'],seed:'verdict'})).status).toBe(verdict);
  expect(fetch).toHaveBeenCalledOnce();
});
let db:TestDatabase;
beforeAll(async()=>{db=await testDatabase();});
afterAll(async()=>{await db?.close();});
it.each([503,'deadline'] as const)('saves only safe judge_attempts in result_summary for %s',async failure=> {
  const f=await fixture(db,'oct30_'+crypto.randomUUID());
  const r=await enqueueRun(db.driver,{workspaceId:f.workspaceId,planId:f.planId,agentVersionId:f.versions.find(v=>v.registry_id==='baseline')!.id,scenarioIds:[f.scenarios.find(s=>s.language==='en')!.id],repeats:1,idempotencyKey:crypto.randomUUID(),recordsOnly:false});
  await runNextConversation({driver:db.driver,inspectionDriver:db.driver,workerId:'oct30',chatModelFactory:()=>journey(),judgeFactory:()=>async()=>{
    let clock=0;const now=()=>clock;
    const chain=createAiChain({store:memoryAiStore(now),env:{GEMINI_API_KEY:key},now,sleep:async ms=>{clock+=ms;},fetch:async()=>{if(failure==='deadline') clock+=1000;return new Response(key+prompt,{status:503});}});
    return judgeReply({chain,input:{prompt,reply},agentFamilies:['nvidia_nemotron'],seed:'safe',deadlineMs:failure==='deadline'?500:90000});
  }});
  const row=(await db.owner.query<{status:string;result_summary:{judge_attempts:unknown[];semantic:{reason:string}}}>('SELECT status,result_summary FROM nazir.conversations WHERE run_id=$1',[r.id])).rows[0]!;
  expect(row.status).toBe('inconclusive');
  expect(row.result_summary.judge_attempts?.length).toBeGreaterThan(0);
  expect(row.result_summary.semantic.reason).toBe(failure==='deadline'?'judge_deadline':'judge_unavailable');
  for(const a of row.result_summary.judge_attempts) expect(Object.keys(a as object).sort()).toEqual(['family','model','ms','provider','reason']);
  const json=JSON.stringify(row.result_summary);
  expect(json).not.toContain(key);
  expect(json).not.toContain(prompt);
  expect(json).not.toContain('https://');
});
it('includes saved judge_attempts in the runner JSON output',()=> {
  const script=readFileSync(new URL('../../scripts/runner-run.mjs',import.meta.url),'utf8');
  expect(script).toContain('judge_attempts:result_summary?.judge_attempts');
});
