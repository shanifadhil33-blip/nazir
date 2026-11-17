import 'server-only';
import type { TransactionDriver } from '../db/driver';
import { Coded } from '../http/errors';
import { runAgentTool } from '../agent/loop';
import { after } from 'next/server';
import { withMember } from '../db/context';
import { activeRuns } from './runs';
import { scheduleRunner } from './schedule';

const uuid = /^[0-9a-f-]{36}$/i;
function idOf(data: unknown, key: 'id' | 'run_id') {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : null;
  return typeof value === 'string' && uuid.test(value) ? value : null;
}
function refusal(data: unknown): never {
  const code = data && typeof data === 'object' ? (data as { error?: { code?: string } }).error?.code : undefined;
  const status = code && ['daily_cap', 'daily_run_cap', 'too_many', 'provider_exhausted', 'repeat_daily_cap', 'run_cap'].includes(code) ? 429 : 409;
  throw new Coded(status, code ?? 'start_failed', 'The check could not start.');
}

/** One tap starts one check: no model reads the request, and a second tap returns the check already running. */
export async function startCheck(driver: TransactionDriver, memberId: string): Promise<{ run_id: string; existing: boolean }> {
  const running = (await activeRuns(driver, memberId)).runs[0] as { run_id?: string } | undefined;
  if (running?.run_id) return { run_id: running.run_id, existing: true };
  const proposed = await runAgentTool(driver, memberId, 'propose_plan', {}, { message: 'run a quick check' });
  const planId = proposed.done ? idOf(proposed.data, 'id') : null;
  if (!planId) refusal(proposed.data);
  const approval = `I approve plan ${planId} and start the run because I reviewed the check size and cost. I opened the evidence.`;
  const started = await runAgentTool(driver, memberId, 'start_run', {}, { message: approval });
  const runId = started.done ? idOf(started.data, 'run_id') : null;
  if (!runId) refusal(started.data);
  superviseStart(driver, memberId, runId);
  return { run_id: runId, existing: false };
}

/**
 * Whoever starts a check watches it for almost five minutes. If it has not begun, or nothing moved for 45 s while an
 * answer is ready to run, it asks the runner again. A lost wake up or a stopped tick chain cannot strand the check.
 */
export function superviseStart(driver: TransactionDriver, memberId: string, runId: string, delays = [8_000, 20_000, 40_000, 70_000, 100_000, 130_000, 160_000, 190_000, 220_000, 250_000, 280_000], sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  try {
    after(async () => {
      let waited = 0;
      for (const at of delays) {
        await sleep(at - waited); waited = at;
        const row = await withMember(driver, memberId, async (sql) => (await sql.query<{ status: string; started_at: string | null; quiet: boolean; ready: boolean }>(
          `SELECT r.status,r.started_at,
             coalesce((SELECT max(greatest(c.finished_at,c.heartbeat_at,c.started_at)) FROM nazir.conversations c WHERE c.run_id=r.id),r.created_at) < clock_timestamp()-interval '45 seconds' AS quiet,
             EXISTS(SELECT FROM nazir.conversations c WHERE c.run_id=r.id AND c.status='queued' AND c.available_at<=clock_timestamp()) AS ready
           FROM nazir.runs r WHERE r.id=$1`, [runId])).rows[0]).catch(() => null);
        if (!row || !['queued', 'running'].includes(row.status)) return;
        if (!row.started_at || (row.quiet && row.ready)) scheduleRunner();
      }
    });
  } catch { /* Outside a request (tests, scripts) there is nothing to supervise. */ }
}
