import 'server-only';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { NotFound } from '../http/errors';
import { assembleReport, projectReport, reportHtml, type ReportBody, type ReportConversation, type ReportFinding, type ReportMessage } from './build';

const createInput = z.object({ run_id: z.uuid() }).strict();

async function evidence(sql: SqlConnection, runId: string) {
  const run = (await sql.query<{ id: string; status: string; calls_used: number; calls_budget: number }>('SELECT id,status,calls_used,calls_budget FROM nazir.runs WHERE id=$1', [runId])).rows[0];
  if (!run) throw new NotFound();
  const conversations = (await sql.query<ReportConversation>(`SELECT c.id,c.status,s.split,c.language FROM nazir.conversations c JOIN nazir.scenarios s ON s.id=c.scenario_id WHERE c.run_id=$1 ORDER BY c.created_at,c.id`, [runId])).rows;
  const findings = (await sql.query<ReportFinding>(`SELECT f.id,f.check_id,f.severity,f.title,f.title_ar,f.really_happened,f.really_happened_ar,f.agent_said,f.evidence,s.split,s.family,f.language
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

/** Saves the full copy, the development copy and the viewer copy from one read of the saved evidence. */
export async function createReport(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = createInput.parse(value);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'report.create');
    const full = await evidence(sql, input.run_id);
    const supplier = projectReport(full, 'development');
    const viewer = projectReport(full, 'viewer');
    const row = (await sql.query<{ id: string; body_hash: string }>(`INSERT INTO nazir.reports(workspace_id,run_id,body,supplier_body,viewer_body)
      VALUES(nazir.current_workspace_id(),$1,$2::jsonb,$3::jsonb,$4::jsonb) RETURNING id,body_hash`, [input.run_id, JSON.stringify(full), JSON.stringify(supplier), JSON.stringify(viewer)])).rows[0]!;
    await sql.query("SELECT nazir.append_audit('report.created','report',$1,$2)", [row.id, JSON.stringify({ run_id: input.run_id, body_hash: row.body_hash })]);
    return { id: row.id, body_hash: row.body_hash, scope: full.scope, counts: full.counts };
  });
}

export async function readFullReport(driver: TransactionDriver, memberId: string, id: string) {
  z.uuid().parse(id);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'report.read');
    return stored(sql, id, 'read_report');
  });
}

export async function readViewerReport(driver: TransactionDriver, memberId: string, id: string) {
  z.uuid().parse(id);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'report.viewer');
    return stored(sql, id, 'read_report_viewer');
  });
}

export async function readReportHtml(driver: TransactionDriver, memberId: string, id: string, copy: 'full' | 'viewer') {
  const body = copy === 'full' ? await readFullReport(driver, memberId, id) : await readViewerReport(driver, memberId, id);
  return reportHtml(body);
}
