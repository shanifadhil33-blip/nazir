import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { activeRuns } from '@/server/runner/runs';
import { startCheck } from '@/server/runner/start';

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => activeRuns(runtimeDriver(), memberId), 200, requestLanguage(request));
}

/** Start a check in one call. The run is queued on the server and the background runner owns it from here. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => startCheck(runtimeDriver(), memberId), 202, requestLanguage(request));
}
