import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { deleteTraces, makeSdkKey, readSdkStatus, turnOffSdkKey } from '@/server/sdk/keys';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ workspaceId: string }> };
/** SDK status, make a key (shown once), turn the key off, or delete all traces. */
export async function GET(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => readSdkStatus(runtimeDriver(), memberId), 200, requestLanguage(request));
}
export async function POST(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => makeSdkKey(runtimeDriver(), memberId), 201, requestLanguage(request));
}
export async function DELETE(request: Request, context: Context) {
  const { workspaceId } = await context.params;
  const what = new URL(request.url).searchParams.get('what');
  return memberRoute(workspaceId, (memberId) => what === 'traces' ? deleteTraces(runtimeDriver(), memberId) : turnOffSdkKey(runtimeDriver(), memberId), 200, requestLanguage(request));
}
