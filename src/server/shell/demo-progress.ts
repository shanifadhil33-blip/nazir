import 'server-only';
import { z } from 'zod';
import { withMember } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { Forbidden, NotFound } from '../http/errors';

export type DemoProgress = { step: number; fixId: string | null; checkId: string | null };
async function requireDemo(sql: SqlConnection) {
  const row = (await sql.query<{ kind: string }>('SELECT kind FROM nazir.workspaces WHERE id=nazir.current_workspace_id()')).rows[0];
  if (row?.kind !== 'demo') throw new Forbidden();
}
async function progress(sql: SqlConnection): Promise<DemoProgress> {
  const row = (await sql.query<{ step: number; fix_id: string | null }>(`WITH events AS (
    SELECT action,target_id,payload,seq FROM nazir.audit_events
    WHERE actor_member_id=nazir.current_member_id()
      AND seq>coalesce((SELECT max(seq) FROM nazir.audit_events WHERE action='demo.history_seeded'),0)
  ) SELECT CASE
    WHEN EXISTS(SELECT 1 FROM events WHERE action='demo.after_opened') THEN 4
    WHEN EXISTS(SELECT 1 FROM events WHERE action='proposal.decide' AND payload->>'decision'='approve') THEN 3
    WHEN EXISTS(SELECT 1 FROM events WHERE action IN ('proposal.create','demo.fix_opened')) THEN 2
    WHEN EXISTS(SELECT 1 FROM events WHERE action='demo.check_opened') THEN 1 ELSE 0 END AS step,
    (SELECT target_id FROM events WHERE action IN ('proposal.create','proposal.decide','demo.after_opened','demo.fix_opened') ORDER BY seq DESC LIMIT 1) AS fix_id`)).rows[0]!;
  // Visitor checks remain in history after a reset. The guide must lead to the
  // planted mistake, even when a newer visitor check has no wrong answers.
  const check = (await sql.query<{ id: string }>(`SELECT id FROM nazir.reports
    WHERE body->>'sample'='true' AND jsonb_array_length(coalesce(body->'findings','[]'::jsonb))>0
    ORDER BY created_at DESC,id DESC LIMIT 1`)).rows[0];
  return { step: row.step, fixId: row.fix_id, checkId: check?.id ?? null };
}
export async function readDemoProgress(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => { await requireDemo(sql); return progress(sql); });
}
/** Only an existing report or a tested fix can advance a view milestone. Writes are idempotent for this reset. */
export async function recordDemoView(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = z.object({ view: z.enum(['check', 'fix', 'after']), id: z.uuid() }).strict().parse(value);
  return withMember(driver, memberId, async (sql) => {
    await requireDemo(sql);
    const exists = input.view === 'check'
      ? await sql.query('SELECT id FROM nazir.reports WHERE id=$1', [input.id])
      : input.view === 'fix' ? await sql.query('SELECT id FROM nazir.proposals WHERE id=$1', [input.id])
      : await sql.query(`SELECT p.id FROM nazir.proposals p JOIN nazir.reports r ON r.run_id=p.retest_run_id JOIN nazir.runs u ON u.id=p.retest_run_id WHERE p.id=$1 AND p.status='approved' AND u.status IN ('passed','failed','inconclusive')`, [input.id]);
    if (!exists.rows.length) throw new NotFound();
    const action = input.view === 'check' ? 'demo.check_opened' : input.view === 'fix' ? 'demo.fix_opened' : 'demo.after_opened';
    await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`demo-view:${memberId}`]);
    const done = (await sql.query(`SELECT 1 FROM nazir.audit_events WHERE actor_member_id=nazir.current_member_id() AND action=$1 AND target_id=$2
      AND seq>coalesce((SELECT max(seq) FROM nazir.audit_events WHERE action='demo.history_seeded'),0)`, [action, input.id])).rows.length > 0;
    if (!done) await sql.query('SELECT nazir.append_audit($1,$2,$3,$4::jsonb)', [action, input.view === 'check' ? 'report' : 'proposal', input.id, '{}']);
    return progress(sql);
  });
}
