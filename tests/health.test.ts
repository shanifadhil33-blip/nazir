import { afterEach, expect, it, vi } from 'vitest';
import { GET } from '../src/app/api/health/route';

vi.mock('../src/server/db/runtime', () => ({ databaseHealth: vi.fn(async () => 'not_configured') }));
afterEach(() => vi.unstubAllEnvs());

it('Returns service health without caching or a commit when unset', async () => {
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ ok: true, db: 'not_configured', service: 'nazir', commit: null });
});
it('Returns the first seven commit characters', async () => {
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '123456789abcdef');
  const response = await GET();
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ ok: true, db: 'not_configured', service: 'nazir', commit: '1234567' });
});
