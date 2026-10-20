import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { stepRun } from '@/server/livetest/drive';
import { runtimeStep } from '@/server/livetest/step-runtime';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; runId: string }> }) {
  const { workspaceId, runId } = await context.params;
  return memberRoute(workspaceId, (memberId) => stepRun(runtimeDriver(), memberId, runId, runtimeStep), 200, requestLanguage(request));
}
