import { runtimeDriver } from '@/server/db/runtime';
import { Coded } from '@/server/http/errors';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { readLiveSides, startLiveTest } from '@/server/livetest/live-test';
export const dynamic = 'force-dynamic';
async function json(request: Request) {
  const text = await request.text();
  if (text.length > 4000) throw new Coded(400, 'validation', 'Check the details and try again.');
  try { return JSON.parse(text) as unknown; } catch { throw new Coded(400, 'validation', 'Check the details and try again.'); }
}
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, async (memberId) => startLiveTest(runtimeDriver(), memberId, await json(request)), 202, requestLanguage(request));
}
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const runs = (new URL(request.url).searchParams.get('runs') ?? '').split(',');
  return memberRoute(workspaceId, async (memberId) => ({ sides: await readLiveSides(runtimeDriver(), memberId, runs) }), 200, requestLanguage(request));
}
