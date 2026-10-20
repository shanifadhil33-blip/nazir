import { createAiChain } from '../ai/chain';
import { postgresAiStore } from '../ai/store';
import type { TransactionDriver } from '../db/driver';
import type { ModelContext } from './worker';
import { judgeReply } from '../judge/judge';
import { ownModelForWorker, type OwnModel } from '../settings/agent-settings';
import { callOwnModelFull, ownUsed } from '../settings/own-model';
export function networkJudge(driver:TransactionDriver,context:ModelContext,settings:Omit<Parameters<typeof createAiChain>[0],'store'> & { own?: Promise<OwnModel> }={}) {
  const { own:ownSetting,...rest }=settings;
  const store=postgresAiStore(driver);
  const own=ownSetting ?? ownModelForWorker(driver,context.workspaceId);
  const free=createAiChain({ ...rest,store:{ ...store,reserve:async (...args) => { if(!await store.reserve(...args)) return false; try { await context.reserveCall(); return true; } catch { return false; } } } });
  // The judge uses the own model only when the agent turns did not, so the judge never grades its own model.
  const chain={ async chat(request:Parameters<typeof free.chat>[0]) {
    const mine=ownUsed.has(context)?null:await own;
    if (mine) {
      let reserved=true; try { await context.reserveCall(); } catch { reserved=false; }
      const reply=reserved?await callOwnModelFull(mine,request):null;
      if (reply && !reply.tool_calls?.length && !request.validate?.(reply)) return { content:reply.content,meta:{ provider:`own_${mine.provider}`,model:mine.model,family:'unknown' as const,attempts:[],failover:false,failoverReason:null } };
    }
    return free.chat(request);
  } };
  return (input:Omit<Parameters<typeof judgeReply>[0],'chain'|'task'>) => judgeReply({ ...input,chain,task:'test_run',deadlineMs:context.remainingMs(),workspaceId:context.workspaceId,conversationId:context.conversationId });
}
