import { readFullReport } from '@/server/reports/read';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string; reportId: string }> }) {
  const { workspaceId, reportId } = await context.params;
  return memberRoute(workspaceId, (memberId) => readFullReport(runtimeDriver(), memberId, reportId));
}
