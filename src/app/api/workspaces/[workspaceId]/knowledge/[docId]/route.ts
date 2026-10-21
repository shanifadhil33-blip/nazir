import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { removeKnowledge } from '@/server/knowledge/knowledge';
export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, context: { params: Promise<{ workspaceId: string; docId: string }> }) {
  const { workspaceId, docId } = await context.params;
  return memberRoute(workspaceId, (memberId) => removeKnowledge(runtimeDriver(), memberId, docId), 200, requestLanguage(request));
}
