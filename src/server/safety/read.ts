import 'server-only';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { NotFound } from '../http/errors';
import { readExternalAgent } from '../settings/external-agent';
import { safetyOwnership } from './ownership';
import { families, familyNames, type Family } from './attacks';
import { overall, credentialExposure, type Outcome, type Severity, type VerdictLine } from './evidence';

type RunRow = { id: string; scope: 'full' | 'replies_only' | 'sample'; status: string; agent_name: string | null; created_at: string; started_at: string | null; finished_at: string | null };
type AttemptRow = { run_id: string; position: number; family: Family; language: 'en' | 'ar'; status: string; outcome: Outcome | null; severity: Severity | null; proven: 'trace' | 'canary' | 'reply' | null; reply: string | null; did: string | null; note: string | null; attack: { needs?: string; turns?: string[] } };

export type SafetySummary = { id: string; scope: RunRow['scope']; status: string; agent: string | null; at: string; finishedAt: string | null; done: number; total: number; verdict: VerdictLine | null; open: number };
export type Weakness = {
  family: Family; title: { en: string; ar: string }; outcome: Outcome; severity: Severity | null; proven: 'trace' | 'canary' | 'reply' | null;
  tried: { en: string; ar: string }; reply: string | null; did: string | null; didTranslations?: { en: string; ar: string }; note: string | null; languages: ('en' | 'ar')[];
  fix: { en: string; ar: string }; mapping: string[]; fixed: boolean; reason: 'test_people' | 'test_people_control' | 'agent_changed' | null;
};
export type SafetyDetail = SafetySummary & { weaknesses: Weakness[]; resisted: Family[] };

const rank: Record<Outcome, number> = { broken: 0, partial: 1, could_not_tell: 2, not_run: 3, resisted: 4 };
const sev: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function summarize(run: RunRow, attempts: AttemptRow[]): SafetySummary {
  const mine = attempts.filter((a) => a.run_id === run.id);
  const done = mine.filter((a) => a.status === 'done').length;
  const finished = run.status === 'done';
  return { id: run.id, scope: run.scope, status: run.status, agent: run.agent_name, at: run.created_at, finishedAt: run.finished_at, done, total: mine.length,
    verdict: finished ? overall(run.scope, byFamily(mine).map((w) => ({ outcome: w.outcome, severity: w.severity }))) : null,
    open: byFamily(mine).filter((w) => w.outcome === 'broken' || w.outcome === 'partial').length };
}

/** One row per family: its worst result across both languages. */
function byFamily(attempts: AttemptRow[], fixed: ReadonlySet<string> = new Set()): Weakness[] {
  const groups = new Map<Family, AttemptRow[]>();
  for (const a of attempts) groups.set(a.family, [...(groups.get(a.family) ?? []), a]);
  return [...groups.entries()].map(([family, rows]) => {
    const worst = [...rows].sort((x, y) => rank[x.outcome ?? 'could_not_tell'] - rank[y.outcome ?? 'could_not_tell'] || (x.severity ? sev[x.severity] : 9) - (y.severity ? sev[y.severity] : 9))[0]!;
    const info = families[family];
    const outcome = worst.outcome ?? 'could_not_tell';
    const exposed = worst.note === 'credential_exposure';
    return {
      family, title: exposed ? { en: 'Exposed a login value', ar: 'كشف بيانات دخول' } : outcome === 'broken' || outcome === 'partial' ? info.title : familyNames[family], outcome, severity: worst.severity, proven: worst.proven, tried: info.tried, reply: worst.reply, did: worst.did, note: worst.note,
      ...(exposed ? { didTranslations: credentialExposure } : {}),
      languages: [...new Set(rows.filter((r) => r.outcome === outcome).map((r) => r.language))], fix: exposed ? { en: 'Keep login values in server authentication. Do not put them in text sent to the model or shown in replies.', ar: 'احتفظ ببيانات الدخول في مصادقة الخادم. لا تضعها في نص يرسل إلى النموذج أو يظهر في الردود.' } : info.fix, mapping: exposed ? ['LLM02', 'ASI03'] : [...info.owasp, ...info.agentic, ...info.atlas], fixed: fixed.has(family),
      reason: worst.note === 'test_people_control' ? 'test_people_control' : (outcome === 'not_run' ? (worst.attack.needs === 'test_people' || worst.note === 'test_people' ? 'test_people' : worst.note === 'agent_changed' ? 'agent_changed' : null) : null) as Weakness['reason'],
    };
  }).sort((x, y) => rank[x.outcome] - rank[y.outcome] || (x.severity ? sev[x.severity] : 9) - (y.severity ? sev[y.severity] : 9));
}

export async function listSafety(driver: TransactionDriver, memberId: string, kind: 'real' | 'demo' | undefined) {
  const demo = kind === 'demo';
  const connection = demo ? null : await readExternalAgent(driver, memberId);
  const agent = demo || Boolean(connection?.ready);
  const ownership = demo ? { confirmed: true, proof: null } : await safetyOwnership(driver, memberId, connection);
  return withMember(driver, memberId, async (sql) => {
    const runs = (await sql.query<RunRow>('SELECT id,scope,status,agent_name,created_at,started_at,finished_at FROM nazir.safety_runs ORDER BY created_at DESC LIMIT 30')).rows;
    const attempts = runs.length ? (await sql.query<AttemptRow>('SELECT run_id,position,family,language,status,outcome,severity,proven,NULL::text AS reply,NULL::text AS did,note,attack FROM nazir.safety_attempts WHERE run_id=ANY($1::uuid[])', [runs.map((r) => r.id)])).rows : [];
    const nextAt = (await sql.query<{ at: string | null }>('SELECT nazir.safety_next_at() AS at')).rows[0]!.at;
    return { runs: runs.map((r) => summarize(r, attempts)), ...ownership, nextAt, demo, agent };
  });
}

export async function readSafety(driver: TransactionDriver, memberId: string, runId: string): Promise<SafetyDetail> {
  return withMember(driver, memberId, async (sql) => {
    const run = (await sql.query<RunRow>('SELECT id,scope,status,agent_name,created_at,started_at,finished_at FROM nazir.safety_runs WHERE id=$1', [runId])).rows[0];
    if (!run) throw new NotFound();
    const attempts = (await sql.query<AttemptRow>('SELECT run_id,position,family,language,status,outcome,severity,proven,reply,did,note,attack FROM nazir.safety_attempts WHERE run_id=$1 ORDER BY position', [runId])).rows;
    const fixed = new Set((await sql.query<{ family: string }>("SELECT family FROM nazir.safety_fixes WHERE approved_at>clock_timestamp()-interval '1 hour'")).rows.map((r) => r.family));
    const all = byFamily(attempts, fixed);
    return { ...summarize(run, attempts), weaknesses: all.filter((w) => w.outcome !== 'resisted'), resisted: all.filter((w) => w.outcome === 'resisted').map((w) => w.family) };
  });
}
