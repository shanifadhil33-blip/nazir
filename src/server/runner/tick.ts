import 'server-only';
import { randomUUID } from 'node:crypto';
import type { TransactionDriver } from '../db/driver';
import { withMember } from '../db/context';
import { recoverStale } from './recover';
import { runNextConversation } from './worker';
import { createReport } from '../reports/read';
import { starterDriver, type PendingRun } from './context';
import { stepParallel, tickBudgetMs, minConversationMs, stepLeaseSeconds } from '../livetest/budget';

export async function pendingRuns(driver: TransactionDriver): Promise<PendingRun[]> {
  return driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_worker');
    return (await sql.query<PendingRun>('SELECT * FROM nazir.runner_pending($1)', [100])).rows;
  });
}

type TickDeps = {
  driver: TransactionDriver;
  inspectionDriver: TransactionDriver;
  lock: () => Promise<null | (() => Promise<void>)>;
  run?: typeof runNextConversation;
  now?: () => number;
  /** Injectable wait keeps retry backoff and expired leases alive after the tab closes. */
  wait?: (ms: number) => Promise<void>;
  budgetMs?: number;
};

/** Oldest first, four independent claims per batch. Only trusted starters enter this loop. */
export async function tick({ driver, inspectionDriver, lock, run = runNextConversation, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), budgetMs = tickBudgetMs }: TickDeps) {
  const release = await lock();
  if (!release) return { busy: true, pending: false };
  const deadline = now() + budgetMs;
  let parallel = stepParallel;
  try {
    while (deadline - now() >= minConversationMs) {
      const pending = await pendingRuns(driver);
      if (!pending.length) return { busy: false, pending: false };
      let advanced = false;
      for (const item of pending) {
        if (deadline - now() < minConversationMs) break;
        const scoped = starterDriver(driver, item);
        try {
          await recoverStale(scoped, item.workspace_id, item.run_id);
          const status = await withMember(scoped, item.started_by, async (sql) => (await sql.query<{ status: string }>('SELECT status FROM nazir.runs WHERE id=$1', [item.run_id])).rows[0]?.status);
          if (status && ['queued', 'running'].includes(status)) {
            const results = await Promise.allSettled(Array.from({ length: parallel }, async (_, slot) => {
              // The existing claim briefly locks the run row too. A skipped claim may be contention,
              // so stagger a few retries while the other slots are already talking to the agent.
              for (let claim = 0; claim < 3 && deadline - now() >= minConversationMs; claim++) {
                const result = await run({ driver: scoped, inspectionDriver, runId: item.run_id, workerId: `tick_${randomUUID()}`, leaseSeconds: stepLeaseSeconds, conversationTimeoutMs: Math.min(50_000, deadline - now() - 5000) });
                if (result) return result;
                if (claim < 2) await wait(50 * (slot + 1));
              }
              return null;
            }));
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value) {
                advanced = true;
                if ('reason' in result.value && result.value.reason === 'provider_exhausted') parallel = 3;
              }
            }
          }
          // createReport refuses active work and serializes concurrent finalization.
          await createReport(scoped, item.started_by, { run_id: item.run_id });
          advanced = true;
        } catch { /* A refused starter or transient fault must not expose evidence or block other checks. */ }
      }
      if (!advanced && deadline - now() >= minConversationMs) await wait(Math.min(1000, deadline - now()));
    }
    return { busy: false, pending: (await pendingRuns(driver)).length > 0 };
  } finally { await release(); }
}
