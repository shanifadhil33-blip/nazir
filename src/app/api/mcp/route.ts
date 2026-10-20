import { bearerToken, mcpHandle } from '@/server/agent/mcp';
import { runtimeDriver } from '@/server/db/runtime';
import { Unauthorized, errorResponse } from '@/server/http/errors';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const token = bearerToken(request.headers.get('authorization'));
  if (!token) {
    const response = errorResponse(new Unauthorized());
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  try {
    return Response.json(await mcpHandle(runtimeDriver(), token, await request.json()), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
