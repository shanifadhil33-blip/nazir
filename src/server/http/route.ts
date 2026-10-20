import 'server-only';
import { requireMember } from '../auth/session';
import { callerLanguage, errorResponse, type CallerLanguage } from './errors';

export function requestLanguage(request?: Request, message?: string | null): CallerLanguage {
  return callerLanguage({ header: request?.headers.get('accept-language'), message });
}

export async function memberRoute(workspaceId: string, work: (memberId: string) => Promise<Response | unknown>, status = 200, language: CallerLanguage = 'en') {
  try {
    const { memberId } = await requireMember(workspaceId);
    const result = await work(memberId);
    const response = result instanceof Response ? result : Response.json(result, { status });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const response = errorResponse(error, language);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}

export function htmlResponse(html: string) {
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
