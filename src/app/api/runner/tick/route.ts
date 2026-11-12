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
      const result = await tick({ driver: runtimeDriver(), inspectionDriver: inspectionRuntimeDriver(), lock: runnerLock });
      if (result.pending || result.busy) scheduleRunner({ busy: result.busy });
    } catch {
      // Recovery will inspect existing conversation leases, never duplicate completed answers.
      scheduleRunner();
    }
  });
  return Response.json({ accepted: true }, { status: 202, headers: { 'cache-control': 'no-store' } });
}
