import type { Lang } from '@/components/ocean/copy';
import { approvalMessage } from './checks-model';

export type RunProgress = { runId: string; done: number; total: number };

const uuid = /^[0-9a-f-]{36}$/i;

export function planIdOf(data: unknown): string | null {
  const id = data && typeof data === 'object' ? (data as { id?: unknown }).id : null;
  return typeof id === 'string' && uuid.test(id) ? id : null;
}

export function runIdOf(data: unknown): string | null {
  const id = data && typeof data === 'object' ? (data as { run_id?: unknown }).run_id : null;
  return typeof id === 'string' && uuid.test(id) ? id : null;
}


type Fetcher = typeof fetch;

export type StartFail = 'limit' | 'unreachable' | 'failed';
export type StartOutcome = { runId: string } | { fail: StartFail };

const limitCodes = new Set(['daily_cap', 'too_many', 'provider_exhausted', 'repeat_daily_cap']);
const unreachableCodes = new Set(['agent_unreachable']);

/** Maps a refused request to the small state the person should see. No response at all means the assistant could not be reached. */
export function failOf(status: number | null, code: string | null): StartFail {
  if (status === 429 || (code && limitCodes.has(code))) return 'limit';
  if (status === null || (code && unreachableCodes.has(code))) return 'unreachable';
  return 'failed';
}

async function chat(fetcher: Fetcher, workspaceId: string, lang: Lang, message: string) {
  const response = await fetcher(`/api/workspaces/${workspaceId}/agent/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': lang },
    body: JSON.stringify({ message }),
  }).catch(() => null);
  const payload = await response?.json().catch(() => null) as { done?: boolean; tool?: string; data?: unknown; error?: { code?: string } } | null;
  return { ok: Boolean(response?.ok), payload, fail: failOf(response ? response.status : null, payload?.error?.code ?? null) };
}

/** Starts a quick check with the existing chat endpoint: one message proposes the plan, one approves it and starts the run. */
export async function startQuickCheckOutcome(workspaceId: string, lang: Lang, fetcher: Fetcher = fetch): Promise<StartOutcome> {
  const proposed = await chat(fetcher, workspaceId, lang, lang === 'ar' ? 'فحص سريع' : 'run a quick check');
  const planId = proposed.ok && proposed.payload?.done ? planIdOf(proposed.payload.data) : null;
  if (!planId) return { fail: proposed.ok ? 'failed' : proposed.fail };
  const started = await chat(fetcher, workspaceId, lang, approvalMessage(planId, lang));
  const runId = started.ok && started.payload?.done ? runIdOf(started.payload.data) : null;
  return runId ? { runId } : { fail: started.ok ? 'failed' : started.fail };
}

/** Same as the outcome version, for callers that only need the run id. */
export async function startQuickCheck(workspaceId: string, lang: Lang, fetcher: Fetcher = fetch): Promise<string | null> {
  const outcome = await startQuickCheckOutcome(workspaceId, lang, fetcher);
  return 'runId' in outcome ? outcome.runId : null;
}

/** Shared server progress. The browser never drives conversations or creates reports. */
export async function readActiveRuns(workspaceId: string, lang: Lang, fetcher: Fetcher = fetch): Promise<RunProgress[] | null> {
  const response = await fetcher(`/api/workspaces/${workspaceId}/runs?active=1`, { headers: { 'accept-language': lang }, cache: 'no-store', signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null) as { runs?: { run_id: string; tries_done: number; tries_total: number }[] } | null;
  if (!Array.isArray(payload?.runs) || payload.runs.some((run) => !run || typeof run.run_id !== 'string' || !Number.isInteger(run.tries_done) || !Number.isInteger(run.tries_total))) return null;
  return payload.runs.map((run) => ({ runId: run.run_id, done: run.tries_done, total: run.tries_total }));
}
export async function kickRun(workspaceId: string, runId: string, fetcher: Fetcher = fetch) {
  await fetcher(`/api/workspaces/${workspaceId}/runs/${runId}/kick`, { method: 'POST' }).catch(() => null);
}

export async function stopRun(workspaceId: string, runId: string, lang: Lang, fetcher: Fetcher = fetch): Promise<boolean> {
  const response = await fetcher(`/api/workspaces/${workspaceId}/runs/${runId}/cancel`, { method: 'POST', headers: { 'accept-language': lang } }).catch(() => null);
  return Boolean(response?.ok);
}
