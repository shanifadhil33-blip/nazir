import 'server-only';
import { z } from 'zod';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, NotFound } from '../http/errors';
import { decideRepair, startRetest, submitRepair } from './proposals';
import { startCheck, superviseStart } from '../runner/start';

/** The plain reasons saved with a one tap decision. The person can read them in History. */
export const fixReasons = {
  approve: 'I checked this fix and want to test it again.',
  reject: 'Not now. I will look at this fix later.',
} as const;

const action = z.enum(['approve', 'reject', 'retest']);
type Row = { id: string; status: string; patch: unknown; instruction: unknown; retest_run_id: string | null; run_status: string | null };

async function read(driver: TransactionDriver, memberId: string, id: string) {
  return withMember(driver, memberId, async (sql) => (await sql.query<Row>(
    'SELECT p.id,p.status,p.patch,p.instruction,p.retest_run_id,r.status AS run_status FROM nazir.proposals p LEFT JOIN nazir.runs r ON r.id=p.retest_run_id WHERE p.id=$1', [id])).rows[0] ?? null);
}

/** Suggest a fix for one wrong answer. A second tap returns the same open fix. */
export async function suggestFix(driver: TransactionDriver, memberId: string, findingId: string) {
  const id = z.uuid().parse(findingId);
  return submitRepair(driver, memberId, { finding_id: id, evidence: 'Suggested from the wrong answer screen.' }, { requirePatch: true });
}

/**
 * Approve and test (built in sample), I changed my agent and test again (your own agent), Not now, or Test again.
 * Every step is saved on the server, so any device shows the same fix and its test again progress.
 */
export async function fixAction(driver: TransactionDriver, memberId: string, proposalId: string, value: unknown) {
  const id = z.uuid().parse(proposalId);
  const what = action.parse(value);
  let row = await read(driver, memberId, id);
  if (!row) throw new NotFound();
  if (what === 'reject') {
    if (row.status === 'rejected') return { id, status: 'rejected' };
    await decideRepair(driver, memberId, { id, decision: 'reject', reason: fixReasons.reject, evidence_opened: true });
    return { id, status: 'rejected' };
  }
  // A sample fix without a change (older data) cannot be approved and tested.
  if (!row.patch && !row.instruction) throw new Coded(409, 'no_fix', 'Nazir has no fix for this answer yet.');
  if (what === 'approve' && row.status === 'proposed') {
    await decideRepair(driver, memberId, { id, decision: 'approve', reason: fixReasons.approve, evidence_opened: true });
    row = (await read(driver, memberId, id))!;
  }
  if (row.status !== 'approved') throw new Coded(409, 'proposal_state', 'This fix cannot be tested now.');
  // A double tap while the test again runs gets the same run.
  if (row.retest_run_id && (what === 'approve' || ['queued', 'running'].includes(row.run_status ?? ''))) return { id, status: 'approved', retest_run_id: row.retest_run_id };
  let runId: string;
  if (row.patch) {
    // The approved sample fix runs its own questions again on the repaired version.
    const runs = await startRetest(driver, memberId, { proposalId: id, sets: ['retest'], repeat_count: 1, ...(what === 'retest' && row.retest_run_id ? { retryOf: row.retest_run_id } : {}) });
    runId = runs.retest!;
    superviseStart(driver, memberId, runId);
  } else {
    // Your own agent: a new check against your agent, after you changed its instructions.
    const started = await startCheck(driver, memberId);
    if (started.existing) throw new Coded(409, 'run_active', 'A check is running now. Test again when it finishes.');
    runId = started.run_id;
  }
  await withMember(driver, memberId, async (sql) => {
    const changed = await sql.query('UPDATE nazir.proposals SET retest_run_id=$1 WHERE id=$2 AND retest_run_id IS DISTINCT FROM $1 RETURNING id', [runId, id]);
    if (changed.rows.length) await sql.query("SELECT nazir.append_audit('proposal.retest','proposal',$1,$2)", [id, JSON.stringify({ run_id: runId })]);
  });
  return { id, status: 'approved', retest_run_id: runId };
}
