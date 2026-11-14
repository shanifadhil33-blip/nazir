import 'server-only';
import type { TransactionDriver } from '../db/driver';
import { Coded } from '../http/errors';
import { runAgentTool } from '../agent/loop';
import { activeRuns } from './runs';

const uuid = /^[0-9a-f-]{36}$/i;
function idOf(data: unknown, key: 'id' | 'run_id') {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : null;
  return typeof value === 'string' && uuid.test(value) ? value : null;
}
function refusal(data: unknown): never {
  const code = data && typeof data === 'object' ? (data as { error?: { code?: string } }).error?.code : undefined;
  const status = code && ['daily_cap', 'too_many', 'provider_exhausted', 'repeat_daily_cap', 'run_cap'].includes(code) ? 429 : 409;
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
  return { run_id: runId, existing: false };
}
