import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { leaseLock } from '../../src/server/runner/lease';

let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); }, 60000);
afterAll(async () => { await db?.close(); });

it('one tick holds the lease; a second is busy until the first releases', async () => {
  const lock = leaseLock(db.driver, { seconds: 30, renewMs: 60_000 });
  const release = await lock(); expect(release).not.toBeNull();
  expect(await lock()).toBeNull();
  await release!();
  const next = await lock(); expect(next).not.toBeNull();
  await next!();
});

it('a lease left by a killed tick expires by itself', async () => {
  const lock = leaseLock(db.driver, { seconds: 5, renewMs: 60_000 });
  const dead = await lock(); expect(dead).not.toBeNull();
  expect(await lock()).toBeNull();
  // The killed tick never releases. Move its expiry into the past as time would.
  await db.owner.query("UPDATE nazir.runner_lease SET expires_at=clock_timestamp()-interval '1 second'");
  const next = await lock(); expect(next).not.toBeNull();
  // The old holder's late release cannot free the new holder's lease.
  await dead!();
  expect(await lock()).toBeNull();
  await next!();
});

it('renewal keeps the lease past its first expiry, and only the worker can touch it', async () => {
  const lock = leaseLock(db.driver, { seconds: 5, renewMs: 20 });
  const release = await lock();
  await new Promise((r) => setTimeout(r, 80));
  const row = (await db.owner.query<{ left: number }>("SELECT extract(epoch FROM expires_at-clock_timestamp())::float AS left FROM nazir.runner_lease")).rows[0]!;
  expect(row.left).toBeGreaterThan(4);
  await release!();
  await expect(db.driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_app'); await sql.query("SELECT nazir.runner_lease_take('tick_aaaaaaaa',30)"); })).rejects.toThrow();
});
