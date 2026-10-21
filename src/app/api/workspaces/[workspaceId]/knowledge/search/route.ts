import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { searchKnowledge } from '@/server/knowledge/knowledge';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').slice(0, 1000);
  const agent = url.searchParams.get('agent_id');
  return memberRoute(workspaceId, async (memberId) => ({ results: await searchKnowledge(runtimeDriver(), memberId, q, agent) }), 200, requestLanguage(request));
}
