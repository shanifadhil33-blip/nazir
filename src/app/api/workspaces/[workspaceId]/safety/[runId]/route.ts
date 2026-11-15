import { requireMember } from '@/server/auth/session';
import { runtimeDriver } from '@/server/db/runtime';
import { errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
import { readSafety } from '@/server/safety/read';
import { stopSafety } from '@/server/safety/run';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ workspaceId: string; runId: string }> };
function failed(error: unknown, request: Request) { const r = errorResponse(error, requestLanguage(request)); r.headers.set('cache-control', 'no-store'); return r; }
export async function GET(request: Request, context: Context) {
  try { const { workspaceId, runId } = await context.params; const member = await requireMember(workspaceId); return Response.json(await readSafety(runtimeDriver(), member.memberId, z.uuid().parse(runId)), { headers: { 'cache-control': 'no-store' } }); }
  catch (error) { return failed(error, request); }
}
/** Stop the test. */
export async function POST(request: Request, context: Context) {
  try { const { workspaceId, runId } = await context.params; const member = await requireMember(workspaceId); return Response.json(await stopSafety(runtimeDriver(), member.memberId, z.uuid().parse(runId)), { headers: { 'cache-control': 'no-store' } }); }
  catch (error) { return failed(error, request); }
}
