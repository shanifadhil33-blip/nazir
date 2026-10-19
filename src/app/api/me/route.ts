import { requireUser } from '@/server/auth/session';
import { errorResponse } from '@/server/http/errors';
export const dynamic = 'force-dynamic';
export async function GET() {
  let response: Response;
  try { response = Response.json(await requireUser()); } catch (error) { response = errorResponse(error); }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
