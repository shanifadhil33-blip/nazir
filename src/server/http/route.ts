import 'server-only';
import { requireMember } from '../auth/session';
import { errorResponse } from './errors';

export async function memberRoute(workspaceId: string, work: (memberId: string) => Promise<Response | unknown>, status = 200) {
  try {
    const { memberId } = await requireMember(workspaceId);
    const result = await work(memberId);
    const response = result instanceof Response ? result : Response.json(result, { status });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

export function htmlResponse(html: string) {
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
