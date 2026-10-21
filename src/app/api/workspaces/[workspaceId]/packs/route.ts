import { z } from 'zod';
import { runtimeDriver } from '@/server/db/runtime';
import { withMember } from '@/server/db/context';
import { Coded } from '@/server/http/errors';
import { memberRoute, requestLanguage } from '@/server/http/route';
import { livePacks, packSummary } from '@/server/packs/catalog';
import { approvePackCases, installPack } from '@/server/packs/install';
import { runtimeForPack } from '@/server/packs/runtime';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  return memberRoute(workspaceId, async (memberId) => {
    // How many of each pack's cases this workspace holds, so a reviewer can see what waits for approval.
    const counts = await withMember(runtimeDriver(), memberId, async (sql) => (await sql.query<{ p: string; installed: number; approved: number }>("SELECT nazir.scenario_pack(starting_state) AS p,count(*)::int AS installed,count(*) FILTER (WHERE status='approved')::int AS approved FROM nazir.scenarios WHERE status IN ('draft','approved') AND nazir.scenario_pack(starting_state)<>'government' GROUP BY 1")).rows);
    return { packs: livePacks.map((p) => { const c = counts.find((x) => x.p === p.id); return { ...packSummary(p), runs: p.runner !== 'none', ...(runtimeForPack(p.id) ? { installed: c?.installed ?? 0, approved: c?.approved ?? 0 } : {}) }; }) };
  }, 200, requestLanguage(request));
}
const body = z.strictObject({ pack: z.string().max(40), action: z.enum(['install', 'approve']) });
/** Install a live pack's agent and cases (owner), or approve its draft cases (a second member). */
export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const raw = await request.json().catch(() => null);
  return memberRoute(workspaceId, async (memberId) => {
    const input = body.safeParse(raw);
    if (!input.success || !runtimeForPack(input.data.pack)) throw new Coded(400, 'validation', 'Check the details and try again.');
    if (input.data.action === 'install') { const r = await installPack(runtimeDriver(), memberId, input.data.pack); return { installed: r.scenarioIds.length, versions: Object.keys(r.versionIds).length }; }
    return { approved: (await approvePackCases(runtimeDriver(), memberId, input.data.pack)).length };
  }, 200, requestLanguage(request));
}
