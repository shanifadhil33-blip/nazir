import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage, withServerTiming } from '@/server/http/route';
import { stepRun } from '@/server/livetest/drive';
import { runtimeStep } from '@/server/livetest/step-runtime';
export const dynamic = 'force-dynamic';
// Must match stepRouteSeconds in src/server/livetest/budget.ts. Each step does at most 50 s of work.
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; runId: string }> }) {
  const startedAt = performance.now();
  const { workspaceId, runId } = await context.params;
  const response = await memberRoute(workspaceId, (memberId) => stepRun(runtimeDriver(), memberId, runId, runtimeStep), 200, requestLanguage(request));
  return withServerTiming(response, 'step', startedAt);
}
