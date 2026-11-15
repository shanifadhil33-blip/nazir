import { requireMember } from '@/server/auth/session';
import { runtimeDriver } from '@/server/db/runtime';
import { Coded, errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
import { approveSafetyFix } from '@/server/safety/run';

export const dynamic = 'force-dynamic';
/** Approve the fix for one weakness of the demo sample agent. */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const member = await requireMember((await context.params).workspaceId);
    const text = await request.text();
    if (text.length > 500) throw new Coded(400, 'validation', 'Check the details and try again.');
    const family = (() => { try { return String((JSON.parse(text) as { family?: string }).family ?? ''); } catch { return ''; } })();
    return Response.json(await approveSafetyFix(runtimeDriver(), member.memberId, family, member.kind), { headers: { 'cache-control': 'no-store' } });
  } catch (error) { const r = errorResponse(error, requestLanguage(request)); r.headers.set('cache-control', 'no-store'); return r; }
}
