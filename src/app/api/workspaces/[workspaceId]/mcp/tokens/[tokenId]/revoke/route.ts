import { revokeMcpToken } from '@/server/agent/mcp';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function POST(_request: Request, context: { params: Promise<{ workspaceId: string; tokenId: string }> }) {
  const { workspaceId, tokenId } = await context.params;
  return memberRoute(workspaceId, (memberId) => revokeMcpToken(runtimeDriver(), memberId, tokenId));
}
