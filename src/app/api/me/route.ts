import { requireUser } from '@/server/auth/session';
import { errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function GET(request?: Request) {
  let response: Response;
  try { response = Response.json(await requireUser()); } catch (error) { response = errorResponse(error, requestLanguage(request)); }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
