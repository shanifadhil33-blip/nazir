import { readReportHtml } from '@/server/reports/read';
import { runtimeDriver } from '@/server/db/runtime';
import { htmlResponse, memberRoute, requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; reportId: string }> }) {
  const { workspaceId, reportId } = await context.params;
  return memberRoute(workspaceId, async (memberId) => htmlResponse(await readReportHtml(runtimeDriver(), memberId, reportId, 'viewer')), 200, requestLanguage(request));
}
