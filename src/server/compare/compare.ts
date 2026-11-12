import 'server-only';
import { withMember } from '../db/context';
import { requireRole } from '../auth/guard';
import type { TransactionDriver, SqlConnection } from '../db/driver';
import { hash } from '../../sandbox/demo-rule-pack';
import { NotFound } from '../http/errors';

export const comparerVersion = 'n17';
export type RunStatus = 'planned' | 'queued' | 'running' | 'passed' | 'failed' | 'inconclusive' | 'cancelled';
export type ConversationRow = {
  id: string; idempotency_key: string; status: RunStatus; inconclusive_reason: string | null; language: 'en' | 'ar';
  scenario_hash: string | null; stable_key: string; family: string; split: string; meaning_id: string;
  failover: boolean; model_provider: string | null; model_id: string | null;
  model_calls: { attempt?: number; provider?: string; model?: string; failover?: boolean }[] | null;
  result_summary: { records?: { id: string; status: string }[]; results?: unknown; semantic?: { status?: string } | null } | null;
  reply?: string | null;
};
export type RunData = { id: string; status: RunStatus; agent_version_id: string; manifest: Record<string, unknown>; created_at?: string; finished_at?: string | null; conversations: ConversationRow[] };
export type PairClass = 'improved' | 'regressed' | 'still_failing' | 'still_passing' | 'inconclusive' | 'unpaired';
export type Side = { conversation_id: string; status: RunStatus; reason: string | null; failing_checks: string[]; semantic: string | null; failover: boolean; providers: string[]; models: string[] };
export type Pair = { key: string; scenario_key: string; language: 'en' | 'ar'; repeat: number; family: string; split: string; a: Side | null; b: Side | null; class: PairClass; check_regressions: string[]; check_improvements: string[]; failover: boolean; better?: 'A' | 'B' | 'same' | 'uncertain' };
type Counts = { paired: number; improved: number; regressed: number; still_failing: number; still_passing: number; inconclusive: number; failover: number };

const finalStatus = new Set<RunStatus>(['passed', 'failed', 'inconclusive']);
// Settings that must stay the same for a fair comparison (brief section 12, control 9).
const frozenKeys = ['aiChainOrder', 'judgeChainOrder', 'rubricVersion', 'judgePromptHash', 'recordsOnly', 'rulePackHash', 'toolManifestHash', 'runnerVersion'] as const;

function checks(summary: ConversationRow['result_summary']): { id: string; status: string }[] {
  if (!summary) return [];
  if (Array.isArray(summary.records)) return summary.records;
  if (Array.isArray(summary.results)) return summary.results as { id: string; status: string }[];
  const nested = summary.results as { records?: { id: string; status: string }[] } | undefined;
  return Array.isArray(nested?.records) ? nested.records : [];
}
function side(c: ConversationRow): Side {
  const calls = c.model_calls ?? [];
  const failing = checks(c.result_summary).filter((r) => r.status === 'fail').map((r) => r.id);
  const semantic = c.result_summary?.semantic?.status ?? null;
  if (semantic === 'contradicted') failing.push('semantic');
  return {
    conversation_id: c.id, status: c.status, reason: c.inconclusive_reason, failing_checks: [...new Set(failing)].sort(), semantic,
    failover: c.failover || calls.some((m) => m.failover === true),
    providers: [...new Set(calls.map((m) => m.provider).filter((v): v is string => !!v))].sort(),
    models: [...new Set(calls.map((m) => m.model).filter((v): v is string => !!v))].sort(),
  };
}
function passedChecks(c: ConversationRow) { return new Set(checks(c.result_summary).filter((r) => r.status === 'pass').map((r) => r.id)); }
function repeatOf(key: string) { const n = Number(key.split(':').at(-1)); return Number.isInteger(n) && n > 0 ? n : 1; }
function classify(a: Side | null, b: Side | null): PairClass {
  if (!a || !b) return 'unpaired';
  // Inconclusive or cancelled on either side is never a pass and never an improvement.
  if (!['passed', 'failed'].includes(a.status) || !['passed', 'failed'].includes(b.status)) return 'inconclusive';
  if (a.status === 'failed' && b.status === 'passed') return 'improved';
  if (a.status === 'passed' && b.status === 'failed') return 'regressed';
  return a.status === 'failed' ? 'still_failing' : 'still_passing';
}
const empty = (): Counts => ({ paired: 0, improved: 0, regressed: 0, still_failing: 0, still_passing: 0, inconclusive: 0, failover: 0 });
function add(c: Counts, p: Pair) {
  if (p.class === 'unpaired') return;
  c.paired++; c[p.class]++; if (p.failover) c.failover++;
}
export function settingsDiffer(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return frozenKeys.filter((k) => hash(a[k] ?? null) !== hash(b[k] ?? null));
}
export function sentences(t: Counts, unpaired: number) {
  return {
    en: [
      `Version B improved ${t.improved} of ${t.paired} paired tests.`,
      `${t.regressed} of ${t.paired} paired tests regressed.`,
      `${t.inconclusive} of ${t.paired} paired tests were inconclusive and are not counted as passes.`,
      `${t.failover} of ${t.paired} paired tests changed provider or model during the run and are listed separately.`,
      `${unpaired} tests ran on one version only and are not paired.`,
    ],
    ar: [
      `حسنت النسخة B نتيجة ${t.improved} من ${t.paired} اختبارات مقترنة.`,
      `تراجعت نتيجة ${t.regressed} من ${t.paired} اختبارات مقترنة.`,
      `كانت ${t.inconclusive} من ${t.paired} اختبارات مقترنة غير حاسمة ولا تحتسب نجاحا.`,
      `تغير المزود أو النموذج أثناء التشغيل في ${t.failover} من ${t.paired} اختبارات مقترنة، وهي مدرجة على حدة.`,
      `${unpaired} اختبارات جرت على نسخة واحدة فقط وليست مقترنة.`,
    ],
  };
}
/** Pure comparison of two finished runs. Pairs only the same scenario, language and repeat with the same scenario hash. */
export function buildComparison(runA: RunData, runB: RunData) {
  if (!finalStatus.has(runA.status) || !finalStatus.has(runB.status) || [...runA.conversations, ...runB.conversations].some((row) => !finalStatus.has(row.status))) throw new Error('Both runs must be finished');
  const index = (r: RunData) => new Map(r.conversations.map((c) => [c.idempotency_key, c]));
  const A = index(runA), B = index(runB);
  const keys = [...new Set([...A.keys(), ...B.keys()])].sort();
  const pairs: Pair[] = [], hashDiffers: string[] = [];
  for (const key of keys) {
    const ca = A.get(key) ?? null, cb = B.get(key) ?? null;
    const base = (ca ?? cb)!;
    const a = ca ? side(ca) : null, b = cb ? side(cb) : null;
    if (ca && cb && ca.scenario_hash !== cb.scenario_hash) {
      hashDiffers.push(key);
      // A changed scenario is a different test: list both sides as unpaired.
      pairs.push({ key, scenario_key: base.stable_key, language: base.language, repeat: repeatOf(key), family: base.family, split: base.split, a, b: null, class: 'unpaired', check_regressions: [], check_improvements: [], failover: !!a?.failover });
      pairs.push({ key, scenario_key: base.stable_key, language: base.language, repeat: repeatOf(key), family: base.family, split: base.split, a: null, b, class: 'unpaired', check_regressions: [], check_improvements: [], failover: !!b?.failover });
      continue;
    }
    const pa = ca ? passedChecks(ca) : new Set<string>(), pb = cb ? passedChecks(cb) : new Set<string>();
    const check_regressions = a && b ? b.failing_checks.filter((id) => pa.has(id) || (id === 'semantic' && a.semantic === 'supported')) : [];
    const check_improvements = a && b ? a.failing_checks.filter((id) => pb.has(id) || (id === 'semantic' && b.semantic === 'supported')) : [];
    pairs.push({ key, scenario_key: base.stable_key, language: base.language, repeat: repeatOf(key), family: base.family, split: base.split, a, b, class: classify(a, b), check_regressions, check_improvements, failover: !!(a?.failover || b?.failover) });
  }
  const totals = empty(), byLanguage = { en: empty(), ar: empty() }, families = new Map<string, Counts & { family: string; split: string }>();
  for (const p of pairs) {
    add(totals, p); add(byLanguage[p.language], p);
    const f = families.get(p.family) ?? { ...empty(), family: p.family, split: p.split };
    add(f, p); families.set(p.family, f);
  }
  const unpaired = { a: pairs.filter((p) => p.class === 'unpaired' && p.a).length, b: pairs.filter((p) => p.class === 'unpaired' && p.b).length };
  const differ = settingsDiffer(runA.manifest, runB.manifest);
  const summary = {
    comparer_version: comparerVersion,
    versions: { a: { run_id: runA.id, agent_version_id: runA.agent_version_id, finished_at: runA.finished_at ?? null }, b: { run_id: runB.id, agent_version_id: runB.agent_version_id, finished_at: runB.finished_at ?? null } },
    totals, byLanguage, byFamily: [...families.values()].sort((x, y) => x.family.localeCompare(y.family)), unpaired,
    regressions: pairs.filter((p) => p.class === 'regressed' || p.check_regressions.length).map((p) => ({ key: p.key, checks: p.check_regressions, split: p.split })),
    failoverPairs: pairs.filter((p) => p.failover && p.class !== 'unpaired').map((p) => p.key),
    settingsDiffer: differ.length ? differ : null, scenarioHashDiffers: hashDiffers,
    sentences: sentences(totals, unpaired.a + unpaired.b),
  };
  return { summary, pairs };
}
/** English and Arabic twins of the same meaning inside one run. */
export function languageParity(run: RunData) {
  const groups = new Map<string, { en?: ConversationRow; ar?: ConversationRow }>();
  for (const c of run.conversations) {
    const k = `${c.meaning_id}:${repeatOf(c.idempotency_key)}`;
    const g = groups.get(k) ?? {}; g[c.language] = c; groups.set(k, g);
  }
  const rows = [...groups.entries()].filter(([, g]) => g.en && g.ar).map(([k, g]) => {
    const en = g.en!, ar = g.ar!;
    const done = (s: RunStatus) => s === 'passed' || s === 'failed';
    const outcome = !done(en.status) || !done(ar.status) ? 'inconclusive' : en.status === ar.status ? 'same' : 'differ';
    return { key: k, family: en.family, split: en.split, en: { scenario_key: en.stable_key, status: en.status }, ar: { scenario_key: ar.stable_key, status: ar.status }, outcome };
  }).sort((x, y) => x.key.localeCompare(y.key));
  const n = rows.length, same = rows.filter((r) => r.outcome === 'same').length, differ = rows.filter((r) => r.outcome === 'differ').length, inconclusive = rows.filter((r) => r.outcome === 'inconclusive').length;
  return {
    run_id: run.id, paired: n, same, differ, inconclusive, rows,
    sentences: {
      en: [`${same} of ${n} English and Arabic pairs had the same outcome.`, `${differ} of ${n} pairs differed.`, `${inconclusive} of ${n} pairs were inconclusive.`, 'A small synthetic difference is a review signal, not proof of unfair treatment.'],
      ar: [`كانت النتيجة نفسها في ${same} من ${n} أزواج بالإنجليزية والعربية.`, `اختلفت النتيجة في ${differ} من ${n} أزواج.`, `كانت ${inconclusive} من ${n} أزواج غير حاسمة.`, 'الفرق الصغير في بيانات تجريبية إشارة للمراجعة، وليس دليلا على معاملة غير عادلة.'],
    },
  };
}
export async function loadRun(sql: SqlConnection, runId: string): Promise<RunData> {
  const run = (await sql.query<{ id: string; status: RunStatus; agent_version_id: string; frozen_manifest: Record<string, unknown>; created_at: string; finished_at: string | null }>('SELECT id,status,agent_version_id,frozen_manifest,created_at::text,finished_at::text FROM nazir.runs WHERE id=$1', [runId])).rows[0];
  if (!run) throw new NotFound();
  const conversations = (await sql.query<ConversationRow>(`SELECT c.id,c.idempotency_key,c.status,c.inconclusive_reason,c.language,c.scenario_hash,s.stable_key,s.family,s.split,s.meaning_id,c.failover,c.model_provider,c.model_id,c.model_calls,c.result_summary,
    (SELECT body FROM nazir.conversation_messages m WHERE m.conversation_id=c.id AND m.speaker='agent' ORDER BY seq DESC LIMIT 1) AS reply
    FROM nazir.conversations c JOIN nazir.scenarios s ON s.id=c.scenario_id WHERE c.run_id=$1 ORDER BY c.idempotency_key`, [runId])).rows;
  return { id: run.id, status: run.status, agent_version_id: run.agent_version_id, manifest: run.frozen_manifest, created_at: run.created_at, finished_at: run.finished_at, conversations };
}
export type PairJudge = (input: { a: string; b: string; seed: string; pair: Pair }) => Promise<{ better: 'A' | 'B' | 'same' | 'uncertain' }>;
/** Compare and store. Owner or reviewer. A pair judge is used only when given, within maxJudgePairs. */
export async function compareRuns(driver: TransactionDriver, memberId: string, input: { runA: string; runB: string; pairJudge?: PairJudge; maxJudgePairs?: number }) {
  if (input.runA === input.runB) throw new Error('Two different runs are needed');
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'comparison.create');
    const a = await loadRun(sql, input.runA), b = await loadRun(sql, input.runB);
    const built = buildComparison(a, b);
    if (input.pairJudge) {
      const replies = (r: RunData) => new Map(r.conversations.map((c) => [c.idempotency_key, c.reply ?? '']));
      const ra = replies(a), rb = replies(b);
      let used = 0; const cap = Math.min(Math.max(input.maxJudgePairs ?? 10, 0), 20);
      for (const p of built.pairs) {
        if (p.class === 'unpaired' || !ra.get(p.key) || !rb.get(p.key)) continue;
        if (used >= cap) break;
        used++;
        const v = await input.pairJudge({ a: ra.get(p.key)!, b: rb.get(p.key)!, seed: `${a.id}:${b.id}:${p.key}`, pair: p });
        p.better = ['A', 'B', 'same'].includes(v.better) ? v.better : 'uncertain';
      }
      (built.summary as Record<string, unknown>).judgedPairs = { judged: used, betterA: built.pairs.filter((p) => p.better === 'A').length, betterB: built.pairs.filter((p) => p.better === 'B').length, same: built.pairs.filter((p) => p.better === 'same').length, uncertain: built.pairs.filter((p) => p.better === 'uncertain').length };
    }
    const row = (await sql.query<{ id: string; summary_hash: string; created_at: string }>(`INSERT INTO nazir.comparisons(workspace_id,run_a_id,run_b_id,comparer_version,summary,pairs) VALUES(nazir.current_workspace_id(),$1,$2,$3,$4::jsonb,$5::jsonb) RETURNING id,summary_hash,created_at::text`, [a.id, b.id, comparerVersion, JSON.stringify(built.summary), JSON.stringify(built.pairs)])).rows[0]!;
    await sql.query("SELECT nazir.append_audit('comparison.created','comparison',$1,$2)", [row.id, JSON.stringify({ run_a: a.id, run_b: b.id, summary_hash: row.summary_hash, paired: built.summary.totals.paired })]);
    return { id: row.id, summary_hash: row.summary_hash, created_at: row.created_at, ...built, parity: { a: languageParity(a), b: languageParity(b) } };
  });
}
export async function readComparisons(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'comparison.read');
    return (await sql.query<{ v: Record<string, unknown> }>('SELECT v FROM nazir.read_comparisons() v')).rows.map((r) => r.v);
  });
}
