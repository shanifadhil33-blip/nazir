import { fixAction } from '@/server/repair/lifecycle';
import { runtimeDriver } from '@/server/db/runtime';
import { Coded } from '@/server/http/errors';
import { memberRoute, requestLanguage } from '@/server/http/route';

export const dynamic = 'force-dynamic';
/** Approve and test, I changed my agent and test again, Not now, or Test again. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string; proposalId: string }> }) {
  const { workspaceId, proposalId } = await context.params;
  return memberRoute(workspaceId, async (memberId) => {
    const text = await request.text();
    if (text.length > 2000) throw new Coded(400, 'validation', 'Check the details and try again.');
    let body: { action?: unknown } = {};
    try { body = JSON.parse(text); } catch { throw new Coded(400, 'validation', 'Check the details and try again.'); }
    return fixAction(runtimeDriver(), memberId, proposalId, body.action);
  }, 200, requestLanguage(request));
}
