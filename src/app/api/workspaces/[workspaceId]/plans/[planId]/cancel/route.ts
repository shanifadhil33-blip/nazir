import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { cancelPlan } from '@/server/runner/cancel';

export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; planId: string }> }) {
  const { workspaceId, planId } = await context.params;
  return memberRoute(workspaceId, (memberId) => cancelPlan(runtimeDriver(), memberId, planId), 200, requestLanguage(request));
}
