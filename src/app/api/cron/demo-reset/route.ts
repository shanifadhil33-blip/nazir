import { secretMatches } from '@/server/agent/mcp';
import { resetDemosDue } from '@/server/demo/reset';
import { runtimeDriver } from '@/server/db/runtime';
import { Unauthorized, errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';
import { scheduleRunner } from '@/server/runner/schedule';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const language = requestLanguage(request);
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretMatches(request.headers.get('authorization'), secret)) {
    const response = errorResponse(new Unauthorized(), language);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  // Daily backstop for a lost tick chain: any queued or running check left behind gets picked up.
  // Hobby allows one daily cron, so open tabs (kick) and the next Start remain the fast paths.
  scheduleRunner();
  try {
    return Response.json({ ok: true, resets: await resetDemosDue(runtimeDriver()) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const response = errorResponse(error, language);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
