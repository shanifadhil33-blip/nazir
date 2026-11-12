import 'server-only';
import { z } from 'zod';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { requireRole } from '../auth/guard';
import { NotFound } from '../http/errors';
import { progress } from '../livetest/drive';
import { scheduleRunner } from './schedule';

export async function activeRuns(driver: TransactionDriver, memberId: string) {
  const runs = await withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'run.read');
    return (await sql.query<{ id: string; workspace_id: string }>("SELECT id,workspace_id FROM nazir.runs WHERE status IN ('queued','running') ORDER BY created_at,id")).rows;
  });
  // Reads use the requesting person's member context, never a supplied workspace.
  return { runs: await Promise.all(runs.map((run) => progress(memberDriver(driver, memberId), run.workspace_id, run.id))) };
}
function memberDriver(driver: TransactionDriver, memberId: string): TransactionDriver {
  return { transaction: (work) => withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'run.read');
    return work(sql);
  }) };
}

const recentKicks = new Map<string, number>();
export async function kickRun(driver: TransactionDriver, memberId: string, runId: string) {
  z.uuid().parse(runId);
  const active = await withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'run.read');
    const row = (await sql.query<{ status: string }>('SELECT status FROM nazir.runs WHERE id=$1 AND workspace_id=nazir.current_workspace_id()', [runId])).rows[0];
    if (!row) throw new NotFound();
    return ['queued', 'running'].includes(row.status);
  });
  const now = Date.now();
  if (active && now - (recentKicks.get(runId) ?? 0) >= 20_000) {
    if (recentKicks.size >= 1000) recentKicks.clear();
    recentKicks.set(runId, now);
    scheduleRunner();
  }
  return { accepted: true };
}
