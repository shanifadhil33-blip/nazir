import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { markBellSeen, readBell } from '@/server/shell/bell';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => readBell(runtimeDriver(), memberId), 200, requestLanguage(request));
}
/** Opening the bell marks everything seen. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => request.json().then((body) => markBellSeen(runtimeDriver(), memberId, body)), 200, requestLanguage(request));
}
