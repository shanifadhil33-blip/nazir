import type { ChatModel } from '../../sandbox/agent';
import type { AiChain, CallMeta } from './chain';
import type { Task } from './store';
export function chainChatModel(chain: AiChain, { task, conversationId, workspaceId, onCall }: { task: Task; conversationId?: string; workspaceId?: string; onCall?: (meta: CallMeta) => void }): ChatModel {
  return async ({ messages, tools }) => {
    const result = await chain.chat({ purpose: 'agent', task, conversationId, workspaceId, messages, tools });
    onCall?.(result.meta);
    return { content: result.content, ...(result.tool_calls ? { tool_calls: result.tool_calls } : {}), ...(result.truncated ? { truncated: true as const } : {}) };
  };
}
