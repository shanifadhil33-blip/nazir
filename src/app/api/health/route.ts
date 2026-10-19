import { databaseHealth } from '@/server/db/runtime';

export async function GET() {
  return Response.json({
    ok: true,
    db: await databaseHealth(),
    service: 'nazir',
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
