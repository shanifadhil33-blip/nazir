import { createAiChain } from '@/server/ai/chain';
import { postgresAiStore } from '@/server/ai/store';
import { agentChat } from '@/server/agent/chat';
import { ownModelFor } from '@/server/settings/agent-settings';
import { withOwnModel } from '@/server/settings/own-model';
import { runtimeDriver } from '@/server/db/runtime';
import { Coded, errorResponse } from '@/server/http/errors';
import { memberRoute, requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  let body: unknown;
  let message: string | undefined;
  try {
    body = await request.json();
    if (body && typeof body === 'object' && 'message' in body && typeof (body as { message?: unknown }).message === 'string') message = (body as { message: string }).message;
  } catch {
    const response = errorResponse(new Coded(400, 'validation', 'Check the details and try again.'), requestLanguage(request));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  return memberRoute(workspaceId, async (memberId) => {
    const driver = runtimeDriver();
    const own = await ownModelFor(driver, memberId).catch(() => ({ model: null, instructions: '' }));
    return agentChat(driver, memberId, body, withOwnModel(own.model, createAiChain({ store: postgresAiStore(driver) })), own.instructions);
  }, 200, requestLanguage(request, message));
}
