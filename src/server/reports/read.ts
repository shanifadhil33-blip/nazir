import 'server-only';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { can, type Role } from '../auth/roles';
import { withMember } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { Forbidden, NotFound } from '../http/errors';
import { assembleReport, projectReport, type ReportBody, type ReportConversation, type ReportFinding, type ReportMessage } from './build';

const createInput = z.object({ run_id: z.uuid() }).strict();

async function rolesOf(sql: SqlConnection) {
  const { rows } = await sql.query<{ role: Role }>('SELECT role FROM nazir.member_roles WHERE member_id=nazir.current_member_id()');
  return rows.map((row) => row.role);
}

async function evidence(sql: SqlConnection, runId: string) {
  const run = (await sql.query<{ id: string; status: string; calls_used: number; calls_budget: number; size?: 'quick' | 'full'; test_count?: number }>(`SELECT id,status,calls_used,calls_budget,frozen_manifest->>'size' AS size,(frozen_manifest->>'testCount')::int AS test_count FROM nazir.runs WHERE id=$1`, [runId])).rows[0];
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
  return row.body;
}

/** Saves one evidence snapshot. Supplier and viewer get the normal development report: hidden cases drop out, nothing else is redacted. */
export async function createReport(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = createInput.parse(value);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'report.create');
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
    const ids = (await sql.query<{ id: string; created_at: string; run_id: string }>('SELECT id, created_at, run_id FROM nazir.list_reports()')).rows;
    const reports = [];
    for (const row of ids) reports.push({ ...row, body: await stored(sql, row.id, fn) });
    return { reports };
  });
}
