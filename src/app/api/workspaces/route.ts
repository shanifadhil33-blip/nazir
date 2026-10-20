import { requireUser } from '@/server/auth/session';
import { createWorkspace } from '@/server/auth/workspaces';
import { runtimeDriver } from '@/server/db/runtime';
import { errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  let response: Response;
  const language = requestLanguage(request);
  try {
    const session = await requireUser();
    response = Response.json(await createWorkspace(runtimeDriver(), session.user.id, await request.json()), { status: 201 });
  } catch (error) { response = errorResponse(error, language); }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
