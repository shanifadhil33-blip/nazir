import { resetDemoNow } from '@/server/demo/reset';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => resetDemoNow(runtimeDriver(), memberId, workspaceId), 200, requestLanguage(request));
}
