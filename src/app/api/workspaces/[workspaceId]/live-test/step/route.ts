import { runtimeDriver } from '@/server/db/runtime';
import { Coded } from '@/server/http/errors';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { stepLiveTest } from '@/server/livetest/live-test';
import { runtimeStep } from '@/server/livetest/step-runtime';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const text = await request.text();
  return memberRoute(workspaceId, async (memberId) => {
    let body: { run_id?: unknown };
    try { body = JSON.parse(text) as { run_id?: unknown }; } catch { throw new Coded(400, 'validation', 'Check the details and try again.'); }
    return stepLiveTest(runtimeDriver(), memberId, body.run_id, runtimeStep);
  }, 200, requestLanguage(request));
}
