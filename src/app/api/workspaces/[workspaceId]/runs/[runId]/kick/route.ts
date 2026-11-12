import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { kickRun } from '@/server/runner/runs';

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; runId: string }> }) {
  const { workspaceId, runId } = await context.params;
  return memberRoute(workspaceId, (memberId) => kickRun(runtimeDriver(), memberId, runId), 202, requestLanguage(request));
}
