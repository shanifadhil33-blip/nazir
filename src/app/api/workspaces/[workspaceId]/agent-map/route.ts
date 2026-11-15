import { requireMember } from '@/server/auth/session';
import { runtimeDriver } from '@/server/db/runtime';
import { errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
import { readAgentMap } from '@/server/safety/read-map';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    const member = await requireMember(workspaceId);
    return Response.json(await readAgentMap(runtimeDriver(), member.memberId, member.kind), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const response = errorResponse(error, requestLanguage(request));
    response.headers.set('cache-control', 'no-store');
    return response;
  }
}
