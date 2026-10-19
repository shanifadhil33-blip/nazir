import './runner-loader.mjs';
import { pathToFileURL } from 'node:url';
export async function main() {
  const [{ createAiChain },{ memoryAiStore },{ judgeReply },{ calibrate,calibrationItems }]=await Promise.all([import('../src/server/ai/chain.ts'),import('../src/server/ai/store.ts'),import('../src/server/judge/judge.ts'),import('../src/server/judge/calibrate.ts')]);
  const cap=Number(process.env.MAX_CALLS??30);
  if(!Number.isSafeInteger(cap) || cap<1 || cap>60) throw new Error('Invalid call cap');
  let calls=0;
  const store=memoryAiStore();
  const chain=createAiChain({ store:{ ...store,reserve:async (...args) => { if(calls>=cap) return false; if(!await store.reserve(...args)) return false; calls++; return true; } } });
  const agentFamilies=(process.env.JUDGE_AGENT_FAMILIES??'nvidia_nemotron').split(',');
  const ids=process.env.CALIBRATION_IDS?.split(',');
  const items=ids?calibrationItems.filter((i) => ids.includes(i.id)):calibrationItems;
  const result=await calibrate(async (input,item) => {
    if(calls>=cap) return null;
    const verdict=await judgeReply({ chain,input,agentFamilies,seed:item.id,task:'probe' });
    console.log(JSON.stringify({ id:item.id,label:item.label,verdict:verdict.status,agree:verdict.status===item.label?'yes':'no',provider:verdict.provider,model:verdict.model,failover:verdict.failover,issue:verdict.issue,attempts:(verdict.attempts??[]).map((a) => `${a.provider}/${a.model}:${a.outcome}${a.reason?':'+a.reason:''}`) }));
    return verdict;
  },items);
  for(const row of result.rows.filter((r) => !r.result)) console.log(JSON.stringify({ id:row.id,label:row.label,verdict:'not run',agree:'no',provider:null,model:null,failover:false }));
  const { rows,...summary }=result;
  console.log(JSON.stringify({ ...summary,calls,items:rows.length }));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Calibration failed'); process.exitCode=1; });
