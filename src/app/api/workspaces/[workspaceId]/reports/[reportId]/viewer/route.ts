import { readViewerReport } from '@/server/reports/read';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; reportId: string }> }) {
  const { workspaceId, reportId } = await context.params;
  return memberRoute(workspaceId, (memberId) => readViewerReport(runtimeDriver(), memberId, reportId), 200, requestLanguage(request));
}
