import { afterEach, expect, it, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@neondatabase/serverless', () => ({ Pool: class { query = query; } }));
import { databaseHealth } from '../../src/server/db/runtime';
import { GET } from '../../src/app/api/health/route';

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); query.mockReset(); });
it('returns not_configured without opening a pool', async () => {
  vi.stubEnv('DATABASE_URL', undefined);
  expect(await databaseHealth()).toBe('not_configured');
  expect(query).not.toHaveBeenCalled();
  expect((await (await GET()).json()).db).toBe('not_configured');
});
it('reports up after SELECT 1', async () => {
  vi.stubEnv('DATABASE_URL', 'unused-test-address');
  query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
  expect((await (await GET()).json()).db).toBe('up');
  expect(query).toHaveBeenCalledWith('SELECT 1');
});
it('reports down without exposing error details', async () => {
  vi.stubEnv('DATABASE_URL', 'unused-test-address');
  query.mockRejectedValue(new Error('private database details'));
  const result = await (await GET()).json();
  expect(result.db).toBe('down');
  expect(JSON.stringify(result)).not.toContain('private');
});
it('bounds the health request to three seconds', async () => {
  vi.useFakeTimers(); vi.stubEnv('DATABASE_URL', 'unused-test-address');
  query.mockImplementation(() => new Promise(() => {}));
  const pending = databaseHealth();
  await vi.advanceTimersByTimeAsync(3000);
  expect(await pending).toBe('down');
});
