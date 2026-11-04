import { driveSteps, type StepOutcome } from '@/components/ocean/step-loop';
import type { Lang } from '@/components/ocean/copy';
import { approvalMessage } from './checks-model';

export type RunProgress = { runId: string; done: number; total: number };
export type RunEnd = 'done' | 'stopped' | 'failed';

const uuid = /^[0-9a-f-]{36}$/i;

export function planIdOf(data: unknown): string | null {
  const id = data && typeof data === 'object' ? (data as { id?: unknown }).id : null;
  return typeof id === 'string' && uuid.test(id) ? id : null;
}

export function runIdOf(data: unknown): string | null {
  const id = data && typeof data === 'object' ? (data as { run_id?: unknown }).run_id : null;
  return typeof id === 'string' && uuid.test(id) ? id : null;
}

export const storeKey = (workspaceId: string) => `nz-check-run-${workspaceId}`;

type Fetcher = typeof fetch;

async function chat(fetcher: Fetcher, workspaceId: string, lang: Lang, message: string) {
  const response = await fetcher(`/api/workspaces/${workspaceId}/agent/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept-language': lang },
    body: JSON.stringify({ message }),
  }).catch(() => null);
  const payload = await response?.json().catch(() => null) as { done?: boolean; tool?: string; data?: unknown } | null;
  return { ok: Boolean(response?.ok), payload };
}

/** Starts a quick check with the existing chat endpoint: one message proposes the plan, one approves it and starts the run. Returns the run id. */
export async function startQuickCheck(workspaceId: string, lang: Lang, fetcher: Fetcher = fetch): Promise<string | null> {
  const proposed = await chat(fetcher, workspaceId, lang, lang === 'ar' ? 'فحص سريع' : 'run a quick check');
  const planId = proposed.ok && proposed.payload?.done ? planIdOf(proposed.payload.data) : null;
  if (!planId) return null;
  const started = await chat(fetcher, workspaceId, lang, approvalMessage(planId, lang));
  return started.ok && started.payload?.done ? runIdOf(started.payload.data) : null;
}

type StepBody = { done: boolean; passed: number; failed: number; inconclusive: number; waiting: number };

/** Drives one run with the existing step endpoint and reports progress after every step. */
export async function driveRun(workspaceId: string, runId: string, lang: Lang, onProgress: (progress: RunProgress) => void, isStopped: () => boolean, fetcher: Fetcher = fetch): Promise<RunEnd> {
  let last = -1;
  let failed = false;
  const end = await driveSteps(async (): Promise<StepOutcome> => {
    if (isStopped()) return 'stop';
    const response = await fetcher(`/api/workspaces/${workspaceId}/runs/${runId}/step`, { method: 'POST', headers: { 'accept-language': lang } }).catch(() => null);
    if (isStopped()) return 'stop';
    if (!response?.ok) {
      if (response && response.status < 500 && response.status !== 503) { failed = true; return 'stop'; }
      return 'error';
    }
    const body = await response.json().catch(() => null) as StepBody | null;
    if (!body) { failed = true; return 'stop'; }
    const finished = body.passed + body.failed + body.inconclusive;
    onProgress({ runId, done: finished, total: finished + body.waiting });
    if (body.done || body.waiting === 0) return 'done';
    if (finished === last) return 'idle';
    last = finished;
    return 'progress';
  });
  if (isStopped()) return 'stopped';
  if (end === 'done') return 'done';
  return failed || end !== 'stop' ? 'failed' : 'stopped';
}

export async function stopRun(workspaceId: string, runId: string, lang: Lang, fetcher: Fetcher = fetch): Promise<boolean> {
  const response = await fetcher(`/api/workspaces/${workspaceId}/runs/${runId}/cancel`, { method: 'POST', headers: { 'accept-language': lang } }).catch(() => null);
  return Boolean(response?.ok);
}
