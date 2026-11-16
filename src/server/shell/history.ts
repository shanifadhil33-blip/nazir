import 'server-only';
import { withMember } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { requireRole } from '../auth/guard';
import type { HistoryKind } from '@/components/shell/history-model';

export type ActivityItem = { id: string; kind: HistoryKind; at: string; href: string; title: string; titleAr: string; right?: number; total?: number; done?: number };
export type ActivityPage = { items: ActivityItem[]; cursor: string | null };
// Only user facing milestones. Raw audit payloads, keys and tool traffic never leave this service.
const actions = ['plan.proposed', 'run_enqueued', 'run_finished', 'proposal.create', 'proposal.decide', 'proposal.rerun', 'proposal.retest', 'member.language', 'agent.settings_saved', 'demo.reset', 'safety.started', 'safety.stopped', 'safety.finished', 'safety.fix_approved'];
export const completionActions = ['run_finished', 'safety.finished'];

type Event = { seq: string; at: string; action: string; target_id: string | null; decision: string | null; event_status: string | null; report_id: string | null; run_id: string | null; fix_id: string | null; title: string | null; title_ar: string | null; right: number | null; total: number | null; done: number | null; status: string | null };

export function activityFromEvent(row: Event, base: string): ActivityItem {
  let kind: HistoryKind;
  let href = `${base}?screen=checks`;
  const check = row.report_id ? `&check=${row.report_id}` : row.run_id ? `&run=${row.run_id}` : '';
  switch (row.action) {
    case 'run_finished': kind = row.event_status === 'cancelled' ? 'checkStopped' : row.fix_id ? 'testDone' : 'checkDone'; href += check; break;
    case 'proposal.create': kind = 'suggested'; href = `${base}?screen=failures&fix=${row.target_id}`; break;
    case 'proposal.decide': kind = row.decision === 'approve' ? 'approved' : 'turnedDown'; href = `${base}?screen=failures&fix=${row.target_id}`; break;
    case 'proposal.rerun': case 'proposal.retest': kind = 'testStarted'; href = `${base}?screen=failures&fix=${row.target_id}`; break;
    case 'member.language': kind = 'languageChanged'; href = `${base}?screen=settings`; break;
    case 'agent.settings_saved': kind = 'settingsChanged'; href = `${base}?screen=settings`; break;
    case 'demo.reset': kind = 'sampleReset'; href = base; break;
    case 'safety.started': kind = 'safetyStarted'; href += `&tab=safety&safety=${row.target_id}`; break;
    case 'safety.finished': kind = 'safetyDone'; href += `&tab=safety&safety=${row.target_id}`; break;
    case 'safety.stopped': kind = 'safetyStopped'; href += `&tab=safety&safety=${row.target_id}`; break;
    case 'safety.fix_approved': kind = 'safetyFixed'; href += '&tab=safety'; break;
    case 'plan.proposed': kind = 'questionsReady'; break;
    default: kind = 'checkStarted'; href += check;
  }
  return { id: String(row.seq), kind, at: new Date(row.at).toISOString(), href, title: row.title ?? '', titleAr: row.title_ar ?? row.title ?? '',
    ...(row.right !== null ? { right: row.right } : {}), ...(row.total !== null ? { total: row.total } : {}), ...(row.done !== null ? { done: row.done } : {}) };
}

/** All joins still run as nazir_app under workspace RLS. Page with the immutable audit sequence. */
export async function activityPage(sql: SqlConnection, limit: number, before: string | null, completions = false): Promise<ActivityPage> {
  const result = await sql.query<Event>(`SELECT a.seq::text, a.at::text, a.action, a.target_id,
    a.payload->>'decision' AS decision, a.payload->>'status' AS event_status,
    r.id AS report_id, coalesce(r.run_id,u.id) AS run_id, tested.id AS fix_id,
    f.title, f.title_ar,
    (r.body->'counts'->>'passed')::int AS right, (r.body->'counts'->>'conversations')::int AS total,
    (SELECT count(*)::int FROM nazir.conversations c WHERE c.run_id=u.id AND c.status NOT IN ('planned','queued','running','cancelled')) AS done,
    u.status
    FROM nazir.audit_events a
    LEFT JOIN nazir.runs u ON a.target_type='run' AND u.id::text=a.target_id
    LEFT JOIN LATERAL (SELECT id,run_id,body FROM nazir.reports WHERE run_id=u.id ORDER BY created_at DESC LIMIT 1) r ON true
    LEFT JOIN nazir.proposals p ON a.target_type='proposal' AND p.id::text=a.target_id
    LEFT JOIN nazir.findings f ON f.id=p.finding_id
    LEFT JOIN LATERAL (SELECT id FROM nazir.proposals WHERE retest_run_id=u.id LIMIT 1) tested ON true
    WHERE a.action=ANY($1::text[]) AND ($2::bigint IS NULL OR a.seq<$2::bigint)
      AND (a.target_type<>'run' OR u.id IS NOT NULL)
    ORDER BY a.seq DESC LIMIT $3`, [completions ? completionActions : actions, before, limit + 1]);
  const base = (await sql.query<{ id: string }>('SELECT nazir.current_workspace_id() AS id')).rows[0]!.id;
  const rows = result.rows.slice(0, limit);
  return { items: rows.map((r) => activityFromEvent(r, `/w/${base}`)), cursor: result.rows.length > limit ? String(rows.at(-1)!.seq) : null };
}

export async function readHistory(driver: TransactionDriver, memberId: string, limit = 50, before: string | null = null) {
  return withMember(driver, memberId, async (sql) => { await requireRole(sql, 'audit.read'); return activityPage(sql, Math.max(1, Math.min(100, limit)), before); });
}
