import { createAiChain } from '@/server/ai/chain';
import { postgresAiStore } from '@/server/ai/store';
import { agentChat } from '@/server/agent/chat';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, async (memberId) => {
    const driver = runtimeDriver();
    return agentChat(driver, memberId, await request.json(), createAiChain({ store: postgresAiStore(driver) }));
  });
}
