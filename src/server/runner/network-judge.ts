import { createAiChain } from '../ai/chain';
import { postgresAiStore } from '../ai/store';
import type { TransactionDriver } from '../db/driver';
import type { ModelContext } from './worker';
import { judgeReply } from '../judge/judge';
export function networkJudge(driver:TransactionDriver,context:ModelContext,settings:Omit<Parameters<typeof createAiChain>[0],'store'>={}) {
  const store=postgresAiStore(driver);
  const chain=createAiChain({ ...settings,store:{ ...store,reserve:async (...args) => { if(!await store.reserve(...args)) return false; try { await context.reserveCall(); return true; } catch { return false; } } } });
  return (input:Omit<Parameters<typeof judgeReply>[0],'chain'|'task'>) => judgeReply({ ...input,chain,task:'test_run',deadlineMs:context.remainingMs(),workspaceId:context.workspaceId,conversationId:context.conversationId });
}
