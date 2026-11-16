import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { readDemoProgress, recordDemoView } from '@/server/shell/demo-progress';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => readDemoProgress(runtimeDriver(), memberId), 200, requestLanguage(request));
}
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, async (memberId) => recordDemoView(runtimeDriver(), memberId, await request.json()), 200, requestLanguage(request));
}
