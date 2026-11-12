import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { activeRuns } from '@/server/runner/runs';

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => activeRuns(runtimeDriver(), memberId), 200, requestLanguage(request));
}
