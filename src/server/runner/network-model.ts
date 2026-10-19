import 'server-only';
import type { TransactionDriver } from '../db/driver';
import { createAiChain } from '../ai/chain';
import { postgresAiStore } from '../ai/store';
import type { AiStateStore } from '../ai/store';
import type { ChatModel } from '../../sandbox/agent';
import type { ModelContext } from './worker';
export type RunnerModel = { model: ChatModel; accounting: 'network' };
/** Reserve a run call immediately before each provider fetch, including failover. */
export function networkChatModel(driver: TransactionDriver,context: ModelContext,settings: Omit<Parameters<typeof createAiChain>[0],'store'> & { store?: AiStateStore } = {}): RunnerModel {
  const { store=postgresAiStore(driver),...chainSettings }=settings;
  const chain=createAiChain({ ...chainSettings,store:{
    ...store,
    async reserve(...args) {
      if (!await store.reserve(...args)) return false;
      await context.reserveCall();
      return true;
    },
  } });
  return { accounting:'network',model:async ({ messages,tools }) => {
    const result=await chain.chat({ purpose:'agent',task:'test_run',messages,tools,conversationId:context.conversationId,workspaceId:context.workspaceId,deadlineMs:context.remainingMs() });
    context.onCall(result.meta);
    return { content:result.content,...(result.tool_calls ? { tool_calls:result.tool_calls } : {}) };
  } };
}
