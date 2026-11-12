import 'server-only';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { can, type Role } from '../auth/roles';
import { withMember } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { Coded, Forbidden, NotFound } from '../http/errors';
import { checkDate } from './date';
import { assembleReport, projectReport, type ReportBody, type ReportConversation, type ReportFinding, type ReportMessage } from './build';

const createInput = z.object({ run_id: z.uuid() }).strict();

async function rolesOf(sql: SqlConnection) {
  const { rows } = await sql.query<{ role: Role }>('SELECT role FROM nazir.member_roles WHERE member_id=nazir.current_member_id()');
  return rows.map((row) => row.role);
}

async function evidence(sql: SqlConnection, runId: string) {
  const run = (await sql.query<ReportBody['run']>(`SELECT id,status,calls_used,calls_budget,finished_at::text,started_at::text,CASE WHEN frozen_manifest ? 'externalAgent' THEN 'replies_only' END AS connection_scope,frozen_manifest->'externalAgent'->>'name' AS agent_name,frozen_manifest->>'size' AS size,(frozen_manifest->>'testCount')::int AS test_count FROM nazir.runs WHERE id=$1`, [runId])).rows[0];
  if (!run) throw new NotFound();
  const conversations = (await sql.query<ReportConversation>(`SELECT c.id,c.status,s.split,c.language,c.scenario_id,c.attempt_number,c.inconclusive_reason FROM nazir.conversations c JOIN nazir.scenarios s ON s.id=c.scenario_id WHERE c.run_id=$1 ORDER BY c.created_at,c.id`, [runId])).rows;
  const findings = (await sql.query<ReportFinding>(`SELECT f.id,f.check_id,f.scenario_id,f.conversation_id,greatest(1,(SELECT count(*)::int FROM nazir.finding_attempts a WHERE a.finding_id=f.id)) AS failed_attempts,f.severity,f.title,f.title_ar,f.really_happened,f.really_happened_ar,f.agent_said,f.evidence,s.split,s.family,f.language
    FROM nazir.findings f JOIN nazir.scenarios s ON s.id=f.scenario_id WHERE f.run_id=$1 ORDER BY f.created_at,f.id`, [runId])).rows;
  const messages = (await sql.query<ReportMessage>(`SELECT m.conversation_id,m.seq,m.speaker,m.body,s.split FROM nazir.conversation_messages m
    JOIN nazir.conversations c ON c.id=m.conversation_id JOIN nazir.scenarios s ON s.id=c.scenario_id WHERE c.run_id=$1 ORDER BY m.conversation_id,m.seq`, [runId])).rows;
  return assembleReport({ run, conversations, findings, messages });
}

async function stored(sql: SqlConnection, id: string, fn: 'read_report' | 'read_report_viewer') {
  const row = (await sql.query<{ body: ReportBody | null }>(`SELECT nazir.${fn}($1) AS body`, [id])).rows[0];
  if (!row?.body) throw new NotFound();
  const connection = (await sql.query<{ connection_scope: 'replies_only' | null; agent_name: string | null }>("SELECT CASE WHEN frozen_manifest ? 'externalAgent' THEN 'replies_only' END AS connection_scope,frozen_manifest->'externalAgent'->>'name' AS agent_name FROM nazir.runs WHERE id=$1", [row.body.run.id])).rows[0];
  return connection?.connection_scope ? { ...row.body, run: { ...row.body.run, ...connection } } : row.body;
}

/** Saves one evidence snapshot. Supplier and viewer get the normal development report: hidden cases drop out, nothing else is redacted. */
export async function createReport(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = createInput.parse(value);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'report.create');
    await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`report:${input.run_id}`]);
    const status = (await sql.query<{ status: string }>('SELECT status FROM nazir.runs WHERE id=$1', [input.run_id])).rows[0]?.status;
    if (!status) throw new NotFound();
    if (!['passed', 'failed', 'inconclusive', 'cancelled'].includes(status)) throw new Coded(409, 'validation', 'Check the details and try again.');
    const existing = (await sql.query<{ id: string; body_hash: string; body: ReportBody }>("SELECT id,body_hash,body FROM nazir.reports WHERE run_id=$1 AND body->'run'->>'status' IN ('passed','failed','inconclusive','cancelled') ORDER BY created_at,id LIMIT 1", [input.run_id])).rows[0];
    if (existing) return { id: existing.id, body_hash: existing.body_hash, scope: existing.body.scope, counts: existing.body.counts };
    const full = await evidence(sql, input.run_id);
    const supplier = projectReport(full, 'development');
    const row = (await sql.query<{ id: string; body_hash: string }>(`INSERT INTO nazir.reports(workspace_id,run_id,body,supplier_body,viewer_body)
      VALUES(nazir.current_workspace_id(),$1,$2::jsonb,$3::jsonb,$4::jsonb) RETURNING id,body_hash`, [input.run_id, JSON.stringify(full), JSON.stringify(supplier), JSON.stringify(supplier)])).rows[0]!;
    await sql.query("SELECT nazir.append_audit('report.created','report',$1,$2)", [row.id, JSON.stringify({ run_id: input.run_id, body_hash: row.body_hash })]);
    return { id: row.id, body_hash: row.body_hash, scope: full.scope, counts: full.counts };
  });
}

/** Owner, reviewer and supplier use the role copy. A viewer in this workspace receives the normal report. */
export async function readFullReport(driver: TransactionDriver, memberId: string, id: string) {
  z.uuid().parse(id);
  return withMember(driver, memberId, async (sql) => {
    const roles = await rolesOf(sql);
    if (can(roles, 'report.read')) return stored(sql, id, 'read_report');
    if (can(roles, 'report.viewer')) return stored(sql, id, 'read_report_viewer');
    throw new Forbidden();
  });
}

export async function listReports(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => {
    const roles = await rolesOf(sql);
    if (!can(roles, 'report.read') && !can(roles, 'report.viewer')) throw new Forbidden();
    const fn = can(roles, 'report.read') ? 'read_report' : 'read_report_viewer';
    // Keep the security-definer projection for each role, evaluated in one SQL
    // statement rather than one network round trip per report.
    const reports = (await sql.query<{ id: string; created_at: string; run_id: string; body: ReportBody }>(
      `SELECT r.id, r.created_at, r.run_id, nazir.${fn}(r.id) AS body FROM nazir.list_reports() r ORDER BY r.created_at DESC, r.id DESC`,
    )).rows;
    if (reports.some((row) => !row.body)) throw new NotFound();
    // Enrich only the projected response. These run reads stay under member RLS;
    // stored evidence and its hash are never rewritten, including legacy reports.
    const dates = (await sql.query<{ id: string; finished_at: string | null; started_at: string | null; connection_scope: 'replies_only' | null; agent_name: string | null }>(
      "SELECT id,finished_at::text,started_at::text,CASE WHEN frozen_manifest ? 'externalAgent' THEN 'replies_only' END AS connection_scope,frozen_manifest->'externalAgent'->>'name' AS agent_name FROM nazir.runs WHERE id=ANY($1::uuid[])",
      [reports.map((row) => row.run_id)],
    )).rows;
    const byRun = new Map(dates.map((row) => [row.id, row]));
    const enriched = reports.map((row) => {
      const date = byRun.get(row.run_id);
      return date ? { ...row, body: { ...row.body, run: { ...row.body.run, finished_at: date.finished_at, started_at: date.started_at, connection_scope: date.connection_scope, agent_name: date.agent_name } } } : row;
    }).sort((a, b) => checkDate(b.created_at, b.body).getTime() - checkDate(a.created_at, a.body).getTime() || b.id.localeCompare(a.id));
    // Every role that may list reports may also read runs; the count drives the first step card.
    const runs = can(roles, 'run.read') ? Number((await sql.query<{ n: string }>('SELECT count(*) AS n FROM nazir.runs')).rows[0]!.n) : reports.length;
    return { reports: enriched, runs };
  });
}
