import { requireMember } from '@/server/auth/session';
import { runtimeDriver } from '@/server/db/runtime';
import { Coded, errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
import { listSafety } from '@/server/safety/read';
import { confirmSafety, startSafety } from '@/server/safety/run';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ workspaceId: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
function failed(error: unknown, request: Request) { const r = errorResponse(error, requestLanguage(request)); r.headers.set('cache-control', 'no-store'); return r; }

export async function GET(request: Request, context: Context) {
  try { const member = await requireMember((await context.params).workspaceId); return json(await listSafety(runtimeDriver(), member.memberId, member.kind)); }
  catch (error) { return failed(error, request); }
}
/** start: Test safety. confirm: I own this agent or have written permission to test it. */
export async function POST(request: Request, context: Context) {
  try {
    const member = await requireMember((await context.params).workspaceId);
    const text = await request.text();
    if (text.length > 1000) throw new Coded(400, 'validation', 'Check the details and try again.');
    const action = (() => { try { return (JSON.parse(text) as { action?: string }).action; } catch { return undefined; } })();
    if (action === 'confirm') { if (member.kind === 'demo') return json({ confirmed: true }); return json(await confirmSafety(runtimeDriver(), member.memberId)); }
    if (action === 'start') return json(await startSafety(runtimeDriver(), member.memberId, member.kind), 202);
    throw new Coded(400, 'validation', 'Check the details and try again.');
  } catch (error) { return failed(error, request); }
}
