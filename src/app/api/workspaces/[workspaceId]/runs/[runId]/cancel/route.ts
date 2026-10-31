import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { cancelRunAsMember } from '@/server/runner/cancel';

export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; runId: string }> }) {
  const { workspaceId, runId } = await context.params;
  return memberRoute(workspaceId, (memberId) => cancelRunAsMember(runtimeDriver(), memberId, runId), 200, requestLanguage(request));
}
