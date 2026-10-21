import { runtimeDriver } from '@/server/db/runtime';
import { Coded } from '@/server/http/errors';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { addKnowledge, listKnowledge } from '@/server/knowledge/knowledge';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => listKnowledge(runtimeDriver(), memberId), 200, requestLanguage(request));
}
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const text = await request.text();
  return memberRoute(workspaceId, (memberId) => {
    if (text.length > 450000) throw new Coded(400, 'validation', 'Check the details and try again.');
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new Coded(400, 'validation', 'Check the details and try again.'); }
    return addKnowledge(runtimeDriver(), memberId, body);
  }, 201, requestLanguage(request));
}
