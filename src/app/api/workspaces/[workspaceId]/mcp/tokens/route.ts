import { issueMcpToken, listMcpTokens } from '@/server/agent/mcp';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => listMcpTokens(runtimeDriver(), memberId), 200, requestLanguage(request));
}
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const body = await request.text();
  return memberRoute(workspaceId, (memberId) => issueMcpToken(runtimeDriver(), memberId, body ? JSON.parse(body) : {}), 201, requestLanguage(request));
}
