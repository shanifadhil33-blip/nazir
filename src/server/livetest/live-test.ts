import 'server-only';
import { packById } from '../packs/catalog';
import { createHash } from 'node:crypto';
import { requireRole } from '../auth/guard';
import { withMember, withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, NotFound, TooMany, errorLines, runReasonLine } from '../http/errors';
import { recoverStale } from '../runner/recover';
import { assertRunCap, maxRunsPerUserPerDay, runStarter } from '../runner/run-cap';
import { providerRegistry } from '../ai/providers';
import { enqueueRun } from '../runner/enqueue';
import { conversationBudget } from './budget';

export type LiveSide = { run_id: string; role: 'clean' | 'planted'; status: string; reply: string | null; cases: { reference: string; queue: string | null }[]; failed_checks: { id: string; en: string; ar: string }[]; reason: string | null; note: { en: string; ar: string } | null };
type Env = Record<string, string | undefined>;

/** The in app test needs the inspection channel and at least one usable free provider. Without them nothing is queued. */
export function liveTestReady(env: Env = process.env) {
  if (!env.INSPECT_DATABASE_URL) return false;
  return providerRegistry(env).some((p) => (!p.keyEnv || !!env[p.keyEnv]) && (!p.needsEnv || !!env[p.needsEnv]));
}

export function cleanComplaint(text: unknown) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return t.length >= 8 && t.length <= 400 ? t : null;
}

const liveKey = (member: string) => `live:${member}:`;

export async function startLiveTest(driver: TransactionDriver, memberId: string, body: unknown, env: Env = process.env) {
  const input = (body ?? {}) as { language?: unknown; complaint?: unknown; planted?: unknown };
  const language = input.language === 'ar' ? 'ar' : input.language === 'en' ? 'en' : null;
  const complaint = cleanComplaint(input.complaint);
  if (!language || !complaint) throw new Coded(400, 'validation', 'Check the details and try again.');
  const planted = input.planted === true;
  const prepared = await withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'run.read');
    const w = (await sql.query<{ id: string; kind: string }>('SELECT id,kind FROM nazir.workspaces WHERE id=nazir.current_workspace_id()')).rows[0];
    if (!w) throw new NotFound();
    if (w.kind !== 'demo') throw new Coded(403, 'live_test_demo_only', 'The live test runs in demo workspaces only.');
    const pack = (await sql.query<{ p: string | null }>("SELECT nazir.read_agent_settings()->>'focus_pack' AS p")).rows[0]?.p ?? 'government';
    if ((packById(pack)?.runner ?? 'government_sandbox') !== 'government_sandbox') throw new Coded(409, 'live_test_government_only', errorLines.live_test_government_only.en);
    if (!liveTestReady(env)) throw new Coded(503, 'live_test_unavailable', 'The live test is not connected here yet. Nothing was queued.');

    return { workspaceId: w.id };
  });
  const startedBy = await runStarter(driver, memberId);
  return withWorker(driver, prepared.workspaceId, async (sql) => {
    const recent = Number((await sql.query<{ n: string }>("SELECT count(*) AS n FROM nazir.runs WHERE idempotency_key LIKE $1 AND created_at>now()-interval '10 minutes'", [liveKey(memberId) + '%'])).rows[0]!.n);
    if (recent >= 6) throw new TooMany();
    // Both sides count toward the daily run cap, so a pair is refused whole, before the complaint copy is made.
    await assertRunCap(sql, startedBy, maxRunsPerUserPerDay - (planted ? 1 : 0));
    const scenario = await sql.query<{ id: string }>('SELECT nazir.live_test_scenario($1,$2,$3) AS id', [memberId, language, complaint]).then((r) => r.rows[0]!.id, () => { throw new Coded(409, 'live_test_unavailable', 'The live test is not connected here yet. Nothing was queued.'); });
    const plan = (await sql.query<{ id: string }>("SELECT id FROM nazir.plans WHERE status='approved' AND budget_calls>=16 ORDER BY budget_calls DESC,created_at,id LIMIT 1")).rows[0];
    const versions = (await sql.query<{ id: string; registry: string }>("SELECT id,config->>'registry_id' AS registry FROM nazir.agent_versions WHERE config->>'registry_id' IN ('repair','baseline','planted_wrong_queue') ORDER BY created_at,id")).rows;
    const clean = versions.find((v) => v.registry === 'repair') ?? versions.find((v) => v.registry === 'baseline');
    const fault = versions.find((v) => v.registry === 'planted_wrong_queue');
    if (!plan || !clean || (planted && !fault)) throw new Coded(409, 'live_test_unavailable', 'The live test is not connected here yet. Nothing was queued.');
    return { plan: plan.id, clean: clean.id, fault: fault?.id, scenario };
  }).then(async (ids) => {
    const stamp = createHash('sha256').update(`${complaint}:${Date.now()}`).digest('hex').slice(0, 16);
    const sides: { role: 'clean' | 'planted'; version: string }[] = [{ role: 'clean', version: ids.clean }];
    if (planted) sides.push({ role: 'planted', version: ids.fault! });
    const runs = [];
    for (const side of sides) {
      const run = await enqueueRun(driver, { workspaceId: prepared.workspaceId, planId: ids.plan, agentVersionId: side.version, scenarioIds: [ids.scenario], repeats: 1, idempotencyKey: `${liveKey(memberId)}${stamp}:${side.role}`, startedBy });
      runs.push({ run_id: run.id, role: side.role });
    }
    await withWorker(driver, prepared.workspaceId, (sql) => sql.query('SELECT nazir.live_test_retire($1)', [ids.scenario]));
    return { runs, language, planted };
  });
}

async function liveRunWorkspace(driver: TransactionDriver, memberId: string, runId: string) {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'run.read');
    const ok = (await sql.query<{ w: string }>('SELECT nazir.current_workspace_id() AS w')).rows[0]?.w;
    if (!ok) throw new NotFound();
    return ok;
  }).then((w) => withWorker(driver, w, async (sql) => {
    const run = (await sql.query<{ id: string }>('SELECT id FROM nazir.runs WHERE id=$1 AND idempotency_key LIKE $2', [runId, liveKey(memberId) + '%'])).rows[0];
    if (!run) throw new NotFound();
    return w;
  }));
}

function noteFor(reason: string | null) {
  const line = runReasonLine(reason);
  return line ? { en: line.en, ar: line.ar } : null;
}

export async function readLiveSides(driver: TransactionDriver, memberId: string, runIds: string[]): Promise<LiveSide[]> {
  const uuid = /^[0-9a-f-]{36}$/i;
  const ids = [...new Set(runIds)].filter((id) => uuid.test(id)).slice(0, 2);
  if (!ids.length) throw new Coded(400, 'validation', 'Check the details and try again.');
  const sides: LiveSide[] = [];
  for (const id of ids) {
    const w = await liveRunWorkspace(driver, memberId, id);
    sides.push(await withWorker(driver, w, async (sql) => {
      const row = (await sql.query<{ status: string; reason: string | null; key: string; summary: { records?: { id: string; status: string; summary?: { en?: string; ar?: string } }[] } | null; cid: string | null }>(`SELECT c.status,c.inconclusive_reason AS reason,r.idempotency_key AS key,c.result_summary AS summary,c.id AS cid
        FROM nazir.runs r LEFT JOIN nazir.conversations c ON c.run_id=r.id WHERE r.id=$1 ORDER BY c.created_at LIMIT 1`, [id])).rows[0]!;
      const reply = row.cid ? (await sql.query<{ body: string }>("SELECT body FROM nazir.conversation_messages WHERE conversation_id=$1 AND speaker='agent' ORDER BY attempt DESC,seq DESC LIMIT 1", [row.cid])).rows[0]?.body ?? null : null;
      const reading = row.cid ? (await sql.query<{ cases: { reference: string; queue?: string }[] | null }>("SELECT reading->'cases' AS cases FROM nazir.state_readings WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [row.cid])).rows[0]?.cases ?? [] : [];
      return { run_id: id, role: row.key.endsWith(':planted') ? 'planted' : 'clean', status: row.status ?? 'queued', reply: reply ? reply.slice(0, 600) : null,
        cases: (reading ?? []).map((c) => ({ reference: c.reference, queue: c.queue ?? null })),
        failed_checks: (row.summary?.records ?? []).filter((c) => c.status === 'fail').map((c) => ({ id: c.id, en: c.summary?.en ?? '', ar: c.summary?.ar ?? '' })), reason: row.reason, note: noteFor(row.reason) };
    }));
  }
  return sides;
}

/** budgetMs is the time this step may give its one conversation (see budget.ts). */
export type StepDeps = { inspectionDriver: () => TransactionDriver; run: (input: { driver: TransactionDriver; inspectionDriver: TransactionDriver; runId: string; budgetMs: number }) => Promise<unknown> };
export async function stepLiveTest(driver: TransactionDriver, memberId: string, runId: unknown, deps: StepDeps, env: Env = process.env, now: () => number = Date.now) {
  const startedAt = now();
  if (typeof runId !== 'string') throw new Coded(400, 'validation', 'Check the details and try again.');
  const workspaceId = await liveRunWorkspace(driver, memberId, runId);
  await recoverStale(driver, workspaceId, runId);
  if (!liveTestReady(env)) throw new Coded(503, 'live_test_unavailable', 'The live test is not connected here yet. Nothing was queued.');
  const budgetMs = conversationBudget(startedAt, now());
  if (budgetMs) await deps.run({ driver, inspectionDriver: deps.inspectionDriver(), runId, budgetMs });
  return (await readLiveSides(driver, memberId, [runId]))[0]!;
}
