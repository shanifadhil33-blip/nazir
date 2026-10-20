import { revokeMcpToken } from '@/server/agent/mcp';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; tokenId: string }> }) {
  const { workspaceId, tokenId } = await context.params;
  return memberRoute(workspaceId, (memberId) => revokeMcpToken(runtimeDriver(), memberId, tokenId), 200, requestLanguage(request));
}
