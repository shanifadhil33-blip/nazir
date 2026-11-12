import { afterEach, expect, it, vi } from 'vitest';
const connection = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ Pool: class { connect = async () => connection; } }));
import { runnerLock } from '../../src/server/db/runtime';
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
it('reserves one connection, unlocks it and releases it without a transaction', async () => {
  vi.stubEnv('DATABASE_URL', 'synthetic');
  connection.query.mockResolvedValueOnce({ rows: [{ held: true }] }).mockResolvedValueOnce({ rows: [{ released: true }] });
  const release = await runnerLock(); expect(release).not.toBeNull();
  expect(connection.release).not.toHaveBeenCalled();
  await release!();
  expect(connection.query.mock.calls.map(([sql]) => sql).join(' ')).not.toMatch(/BEGIN|COMMIT/);
  expect(connection.release).toHaveBeenCalledWith(undefined);
});
it('returns a busy connection immediately and destroys a connection whose unlock fails', async () => {
  vi.stubEnv('DATABASE_URL', 'synthetic');
  connection.query.mockResolvedValueOnce({ rows: [{ held: false }] });
  expect(await runnerLock()).toBeNull(); expect(connection.release).toHaveBeenCalledTimes(1);
  connection.query.mockResolvedValueOnce({ rows: [{ held: true }] }).mockRejectedValueOnce(new Error('lost connection'));
  const release = await runnerLock(); await release!();
  expect(connection.release).toHaveBeenLastCalledWith(true);
});
