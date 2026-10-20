import 'server-only';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';

export type MeasureRow = { registry: string | null; status: string; language: string; stable_key: string | null; records: { id: string; status: string }[]; semantic: string | null; calls: number; has_reading: boolean };
export type Metric = { id: string; value: number | null; numerator: number; denominator: number; unit: 'percent' | 'points' | 'calls' };

const pct = (n: number, d: number) => d ? Math.round((n / d) * 1000) / 10 : null;
const finished = (r: MeasureRow) => ['passed', 'failed', 'inconclusive'].includes(r.status);
/** The judge stores supported or contradicted; older rows used pass or fail. Unavailable is not a verdict. */
const judge = (s: string | null) => s === 'supported' || s === 'pass' ? 'pass' : s === 'contradicted' || s === 'fail' ? 'fail' : null;
const verdict = (r: MeasureRow) => r.status === 'passed' || r.status === 'failed';

/** Every number comes from saved conversations; no estimate, no model call. Denominators travel with each value. */
export function measure(rows: MeasureRow[]): { metrics: Metric[]; conversations: number; runs?: number } {
  const done = rows.filter(finished);
  const decided = done.filter(verdict);
  const planted = decided.filter((r) => r.registry?.startsWith('planted_'));
  const clean = decided.filter((r) => r.registry && !r.registry.startsWith('planted_'));
  const action = decided.filter((r) => r.records.some((c) => ['case_exists', 'right_queue', 'linked_escalation'].includes(c.id)));
  const actionOk = action.filter((r) => r.records.filter((c) => ['case_exists', 'right_queue', 'linked_escalation'].includes(c.id)).every((c) => c.status === 'pass'));
  const claims = decided.filter((r) => r.records.some((c) => c.id === 'reply_matches_record'));
  const claimsOk = claims.filter((r) => r.records.find((c) => c.id === 'reply_matches_record')!.status === 'pass');
  const judged = decided.filter((r) => judge(r.semantic) !== null);
  const agree = judged.filter((r) => (judge(r.semantic) === 'pass') === r.records.every((c) => c.status === 'pass'));
  const rate = (lang: string) => { const l = clean.filter((r) => r.language === lang); return { n: l.filter((r) => r.status === 'passed').length, d: l.length }; };
  const en = rate('en'), ar = rate('ar');
  const enP = pct(en.n, en.d), arP = pct(ar.n, ar.d);
  const evidence = done.filter((r) => r.has_reading && r.records.length > 0);
  const calls = rows.reduce((n, r) => n + r.calls, 0);
  return {
    conversations: rows.length,
    metrics: [
      { id: 'planted_detection', value: pct(planted.filter((r) => r.status === 'failed').length, planted.length), numerator: planted.filter((r) => r.status === 'failed').length, denominator: planted.length, unit: 'percent' },
      { id: 'false_alarms', value: pct(clean.filter((r) => r.status === 'failed').length, clean.length), numerator: clean.filter((r) => r.status === 'failed').length, denominator: clean.length, unit: 'percent' },
      { id: 'action_correctness', value: pct(actionOk.length, action.length), numerator: actionOk.length, denominator: action.length, unit: 'percent' },
      { id: 'claim_integrity', value: pct(claimsOk.length, claims.length), numerator: claimsOk.length, denominator: claims.length, unit: 'percent' },
      { id: 'language_parity', value: enP === null || arP === null ? null : Math.round(Math.abs(enP - arP) * 10) / 10, numerator: en.n + ar.n, denominator: en.d + ar.d, unit: 'points' },
      { id: 'judge_agreement', value: pct(agree.length, judged.length), numerator: agree.length, denominator: judged.length, unit: 'percent' },
      { id: 'reliability', value: pct(decided.length, rows.filter((r) => r.status !== 'queued' && r.status !== 'running').length), numerator: decided.length, denominator: rows.filter((r) => r.status !== 'queued' && r.status !== 'running').length, unit: 'percent' },
      { id: 'evidence_completeness', value: pct(evidence.length, done.length), numerator: evidence.length, denominator: done.length, unit: 'percent' },
      { id: 'cost', value: done.length ? Math.round((calls / Math.max(1, done.length)) * 10) / 10 : null, numerator: calls, denominator: done.length, unit: 'calls' },
    ],
  };
}

export async function measuredResults(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'run.read');
    // Raw conversations are readable only by members who run tests; a viewer gets an honest note, not zeros.
    const canWork = (await sql.query<{ ok: boolean }>('SELECT nazir.member_can_work() AS ok')).rows[0]?.ok === true;
    if (!canWork) return { conversations: 0, metrics: [] as Metric[], runs: 0, cost_money: 0, restricted: true };
    const rows = (await sql.query<MeasureRow & { records: unknown }>(`SELECT v.config->>'registry_id' AS registry, c.status, c.language, s.stable_key,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',x->>'id','status',x->>'status')) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.result_summary->'records')='array' THEN c.result_summary->'records' ELSE '[]'::jsonb END) x),'[]'::jsonb) AS records,
        c.result_summary->'semantic'->>'status' AS semantic,
        CASE WHEN jsonb_typeof(c.model_calls)='array' THEN jsonb_array_length(c.model_calls) ELSE 0 END AS calls,
        EXISTS(SELECT 1 FROM nazir.state_readings r WHERE r.conversation_id=c.id) AS has_reading
      FROM nazir.conversations c JOIN nazir.runs ru ON ru.id=c.run_id LEFT JOIN nazir.agent_versions v ON v.id=coalesce(c.agent_version_id,ru.agent_version_id) LEFT JOIN nazir.scenarios s ON s.id=c.scenario_id
      WHERE c.workspace_id=nazir.current_workspace_id() AND (c.scenario_id IS NULL OR s.id IS NOT NULL)
      ORDER BY c.created_at DESC LIMIT 2000`)).rows;
    const runs = Number((await sql.query<{ n: string }>('SELECT count(*) AS n FROM nazir.runs')).rows[0]!.n);
    return { ...measure(rows.map((r) => ({ ...r, records: r.records as MeasureRow['records'], calls: Number(r.calls) }))), runs, cost_money: 0, restricted: false };
  });
}
