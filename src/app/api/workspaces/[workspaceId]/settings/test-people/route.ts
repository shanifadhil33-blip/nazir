import { requireMember } from '@/server/auth/session';
import { runtimeDriver } from '@/server/db/runtime';
import { Coded, Forbidden, errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
import { readTestPeople, removeTestPeople, saveTestPeople } from '@/server/safety/test-people';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ workspaceId: string }> };
async function route(request: Request, context: Context, action: 'read' | 'save' | 'remove') {
  try {
    const member = await requireMember((await context.params).workspaceId);
    if (member.kind !== 'real' || !member.roles.includes('service_owner')) throw new Forbidden();
    const driver = runtimeDriver(); let result;
    if (action === 'read') result = { people: await readTestPeople(driver, member.memberId) };
    else if (action === 'remove') result = await removeTestPeople(driver, member.memberId);
    else {
      if (Number(request.headers.get('content-length')) > 12000) throw new Coded(400, 'validation', '');
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        if (reader) while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 12000) throw new Coded(400, 'validation', '');
          chunks.push(value);
        }
      } finally { await reader?.cancel().catch(() => {}); }
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new Coded(400, 'validation', ''); }
      result = { people: await saveTestPeople(driver, member.memberId, value) };
    }
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { const response = errorResponse(error, requestLanguage(request)); response.headers.set('cache-control', 'no-store'); return response; }
}
export const GET = (request: Request, context: Context) => route(request, context, 'read');
export const PUT = (request: Request, context: Context) => route(request, context, 'save');
export const DELETE = (request: Request, context: Context) => route(request, context, 'remove');
