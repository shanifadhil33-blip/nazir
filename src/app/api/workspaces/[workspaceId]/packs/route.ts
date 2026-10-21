import { memberRoute, requestLanguage } from '@/server/http/route';
import { livePacks, packSummary } from '@/server/packs/catalog';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, async () => ({ packs: livePacks.map(packSummary) }), 200, requestLanguage(request));
}
