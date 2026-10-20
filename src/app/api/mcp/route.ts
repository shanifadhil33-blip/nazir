import { bearerToken, mcpHandle } from '@/server/agent/mcp';
import { runtimeDriver } from '@/server/db/runtime';
import { Coded, Unauthorized, errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const language = requestLanguage(request);
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) {
    const response = errorResponse(new Unauthorized(), language);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  let body: unknown;
  try { body = await request.json(); }
  catch {
    const response = errorResponse(new Coded(400, 'validation', 'Check the details and try again.'), language);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  try {
    return Response.json(await mcpHandle(runtimeDriver(), token, body), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const response = errorResponse(error, language);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
