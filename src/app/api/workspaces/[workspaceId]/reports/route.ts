import { createReport, listReports } from '@/server/reports/read';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const query = new URL(request.url).searchParams;
  return memberRoute(workspaceId, (memberId) => listReports(runtimeDriver(), memberId, query.get('include')?.split(',') ?? [], query.get('fix') ?? undefined), 200, requestLanguage(request));
}
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, async (memberId) => createReport(runtimeDriver(), memberId, await request.json()), 201, requestLanguage(request));
}
