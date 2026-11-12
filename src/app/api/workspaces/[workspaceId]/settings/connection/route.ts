import { requireUser } from '@/server/auth/session';
import { runtimeDriver } from '@/server/db/runtime';
import { Coded, Forbidden, NotFound, errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
import { readExternalAgent, saveExternalAgent, testExternalAgent, removeExternalAgent } from '@/server/settings/external-agent';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ workspaceId: string }> };
async function route(request: Request, context: Context, action: 'read' | 'save' | 'test' | 'remove') {
  const language = requestLanguage(request);
  try {
    const { workspaceId } = await context.params;
    const session = await requireUser();
    const member = session.memberships.find((m) => m.workspaceId === workspaceId);
    if (!member) throw new NotFound();
    if (action !== 'read' && (member.kind === 'demo' || !member.roles.includes('service_owner'))) throw new Forbidden();
    const driver = runtimeDriver();
    let body: unknown;
    if (action === 'save' || action === 'test') {
      const text = await request.text();
      if (text.length > 10000) throw new Coded(400, 'validation', 'Check the details and try again.');
      body = JSON.parse(text);
    }
    const result = action === 'read' ? await readExternalAgent(driver, member.memberId)
      : action === 'save' ? await saveExternalAgent(driver, member.memberId, body)
      : action === 'test' ? await testExternalAgent(driver, member.memberId, body)
      : await removeExternalAgent(driver, member.memberId);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    const response = errorResponse(e, language);
    response.headers.set('cache-control', 'no-store');
    return response;
  }
}
export const GET = (r: Request, c: Context) => route(r, c, 'read');
export const PUT = (r: Request, c: Context) => route(r, c, 'save');
export const POST = (r: Request, c: Context) => route(r, c, 'test');
export const DELETE = (r: Request, c: Context) => route(r, c, 'remove');
