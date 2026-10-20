import { createReport } from '@/server/reports/read';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, async (memberId) => createReport(runtimeDriver(), memberId, await request.json()), 201);
}
