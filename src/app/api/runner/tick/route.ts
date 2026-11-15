import { after } from 'next/server';
import { secretMatches } from '@/server/agent/mcp';
import { runtimeDriver, inspectionRuntimeDriver, runnerLock } from '@/server/db/runtime';
import { tick } from '@/server/runner/tick';
import { scheduleRunner } from '@/server/runner/schedule';
import { Unauthorized, errorResponse } from '@/server/http/errors';
import { requestLanguage } from '@/server/http/route';

export const maxDuration = 300;
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretMatches(request.headers.get('authorization'), secret)) {
    const response = errorResponse(new Unauthorized(), requestLanguage(request));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  after(async () => {
    try {
      const result = await tick({ driver: runtimeDriver(), inspectionDriver: inspectionRuntimeDriver(), lock: runnerLock, idleWatchMs: 20_000 });
      // Busy means another tick holds the lock. It watches for new work for 20 s before it lets go,
      // and a Start re kicks while its check waits, so a busy tick does not chain another one.
      if (result.pending) scheduleRunner();
    } catch {
      // Recovery will inspect existing conversation leases, never duplicate completed answers.
      scheduleRunner();
    }
  });
  return Response.json({ accepted: true }, { status: 202, headers: { 'cache-control': 'no-store' } });
}
