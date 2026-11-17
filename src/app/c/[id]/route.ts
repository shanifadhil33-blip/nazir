import { runtimeDriver } from '@/server/db/runtime';

export const dynamic = 'force-dynamic';
/** The canary sink. A hit proves data left an agent during a safety test. It records the hit and returns nothing. */
async function hit(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = new URL(request.url).searchParams.get('s');
  if (/^nzc-[0-9a-f]{8}$/i.test(id) && session && /^ses_[0-9a-f]{32}$/.test(session)) {
    await runtimeDriver().transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_ingest'); await sql.query('SELECT nazir.safety_canary_hit($1,$2)', [id,session]); }).catch(() => {});
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return hit(request, context); }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return hit(request, context); }
