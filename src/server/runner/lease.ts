import { randomUUID } from 'node:crypto';
import type { TransactionDriver } from '../db/driver';

/**
 * One background tick at a time, held as a short lease row that it renews while it works.
 * A session advisory lock leaked through the transaction pooler and left checks queued for hours;
 * a lease ends by itself within `seconds` if the tick is killed.
 */
export function leaseLock(driver: TransactionDriver, { seconds = 60, renewMs = 20_000 }: { seconds?: number; renewMs?: number } = {}) {
  const call = (sql: string, params: unknown[]) => driver.transaction(async (db) => {
    await db.query('SET LOCAL ROLE nazir_worker');
    return (await db.query<{ ok: boolean }>(sql, params)).rows[0]?.ok === true;
  });
  return async (): Promise<null | (() => Promise<void>)> => {
    const holder = `tick_${randomUUID()}`;
    if (!(await call('SELECT nazir.runner_lease_take($1,$2) AS ok', [holder, seconds]))) return null;
    const timer = setInterval(() => { call('SELECT nazir.runner_lease_take($1,$2) AS ok', [holder, seconds]).catch(() => {}); }, renewMs);
    timer.unref?.();
    return async () => {
      clearInterval(timer);
      await call('SELECT nazir.runner_lease_release($1) AS ok', [holder]).catch(() => {});
    };
  };
}
