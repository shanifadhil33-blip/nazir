import { secretMatches } from '@/server/agent/mcp';
import { resetDemosDue } from '@/server/demo/reset';
import { runtimeDriver } from '@/server/db/runtime';
import { Unauthorized, errorResponse } from '@/server/http/errors';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretMatches(request.headers.get('authorization'), secret)) {
    const response = errorResponse(new Unauthorized());
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  try {
    return Response.json({ ok: true, resets: await resetDemosDue(runtimeDriver()) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
