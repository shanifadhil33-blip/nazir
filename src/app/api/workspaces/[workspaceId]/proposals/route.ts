import { listProposals } from '@/server/repair/list';
import { suggestFix } from '@/server/repair/lifecycle';
import { Coded } from '@/server/http/errors';
import { runtimeDriver } from '@/server/db/runtime';
import { memberRoute, requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, (memberId) => listProposals(runtimeDriver(), memberId), 200, requestLanguage(request));
}

/** Suggest a fix for one wrong answer. A second tap returns the same open fix. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, async (memberId) => {
    const text = await request.text();
    if (text.length > 2000) throw new Coded(400, 'validation', 'Check the details and try again.');
    let body: { finding_id?: unknown } = {};
    try { body = JSON.parse(text); } catch { throw new Coded(400, 'validation', 'Check the details and try again.'); }
    return suggestFix(runtimeDriver(), memberId, String(body.finding_id ?? ''));
  }, 201, requestLanguage(request));
}
