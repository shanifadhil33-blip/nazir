import 'server-only';
import type { TransactionDriver } from '../db/driver';
import { createAiChain } from '../ai/chain';
import { postgresAiStore } from '../ai/store';
import type { AiStateStore } from '../ai/store';
import type { ChatModel } from '../../sandbox/agent';
import type { ModelContext } from './worker';
import { ownModelForWorker, type OwnModel } from '../settings/agent-settings';
import { callOwnModelFull, ownUsed } from '../settings/own-model';
import type { pinnedHttpsFetch, Resolver } from '../settings/net-guard';
export type RunnerModel = { model: ChatModel; accounting: 'network' };
/** Reserve a run call immediately before each provider fetch, including failover. */
export function networkChatModel(driver: TransactionDriver,context: ModelContext,settings: Omit<Parameters<typeof createAiChain>[0],'store'> & { store?: AiStateStore; own?: Promise<OwnModel>; resolve?: Resolver; ownFetcher?: typeof pinnedHttpsFetch } = {}): RunnerModel {
  const { store=postgresAiStore(driver),own:ownSetting,resolve,ownFetcher,...chainSettings }=settings;
  // The owner's own model goes first for the agent under test; the free chain answers when it is missing or fails.
  const own=ownSetting ?? ownModelForWorker(driver,context.workspaceId);
  const chain=createAiChain({ ...chainSettings,store:{
    ...store,
    async reserve(...args) {
      if (!await store.reserve(...args)) return false;
      await context.reserveCall();
      return true;
    },
  } });
  return { accounting:'network',model:async ({ messages,tools }) => {
    const mine=await own;
    if (mine) {
      await context.reserveCall();
      const reply=await callOwnModelFull(mine,{ purpose:'agent',task:'test_run',messages,tools },ownFetcher,resolve);
      if (reply && (reply.tool_calls??[]).every((c) => (tools??[]).some((t) => t.function.name===c.name))) {
        ownUsed.add(context);
        context.onCall({ provider:`own_${mine.provider}`,model:mine.model,family:'unknown',attempts:[],failover:false,failoverReason:null });
        return { content:reply.content,...(reply.tool_calls ? { tool_calls:reply.tool_calls } : {}) };
      }
    }
    const result=await chain.chat({ purpose:'agent',task:'test_run',messages,tools,conversationId:context.conversationId,workspaceId:context.workspaceId,deadlineMs:context.remainingMs() });
    context.onCall(result.meta);
    return { content:result.content,...(result.tool_calls ? { tool_calls:result.tool_calls } : {}),...(result.truncated ? { truncated:true as const } : {}) };
  } };
}
