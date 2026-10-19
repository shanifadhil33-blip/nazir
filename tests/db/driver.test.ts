import { expect, it, vi } from 'vitest';
import { poolDriver } from '../../src/server/db/driver';
import { withMember, withWorker } from '../../src/server/db/context';
import { testDatabase } from '../helpers/pglite';

it('commits successful work and releases the connection', async () => {
  const db = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  expect(await poolDriver({ connect: async () => db }).transaction(async () => 'result')).toBe('result');
  expect(db.query.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'COMMIT']);
  expect(db.release).toHaveBeenCalledOnce();
});
it('rolls back failed work, preserves its error and releases', async () => {
  const db = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  await expect(poolDriver({ connect: async () => db }).transaction(async () => { throw new Error('failure'); })).rejects.toThrow('failure');
  expect(db.query.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'ROLLBACK']);
  expect(db.release).toHaveBeenCalledOnce();
});
it('rejects invalid UUIDs before reserving a connection', async () => {
  const driver = { transaction: vi.fn() };
  for (const fn of [withMember, withWorker]) {
    await expect(fn(driver, "bad';select 1", async () => {})).rejects.toThrow('Invalid context UUID');
  }
  expect(driver.transaction).not.toHaveBeenCalled();
});
it('clears role and context after a committed or failed request', async () => {
  const db = await testDatabase();
  try {
    const a = await db.bootstrap('Context');
    await db.member(a.member_id, (sql) => sql.query('SELECT * FROM nazir.workspaces'));
    await expect(db.worker(a.workspace_id, async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    const result = await db.owner.query("SELECT current_setting('role') AS role, nullif(current_setting('app.member_id',true),'') AS member, nullif(current_setting('app.workspace_id',true),'') AS workspace");
    expect(result.rows).toEqual([{ role: 'none', member: null, workspace: null }]);
  } finally { await db.close(); }
});
