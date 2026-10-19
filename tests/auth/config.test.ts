import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.stubEnv('AUTH_SECRET', 'fake-auth-secret');
const { authConfig, handlers, signIn } = await import('../../src/auth');
afterEach(() => { vi.unstubAllEnvs(); });
it('uses Google only, minimal scopes and database sessions lasting 30 days', () => {
  expect(authConfig.providers).toHaveLength(1);
  const google = authConfig.providers[0]!;
  expect(google).toMatchObject({ id: 'google', options: { authorization: { params: { scope: 'openid email profile', prompt: 'select_account' } } } });
  expect(authConfig.session).toEqual({ strategy: 'database', maxAge: 2592000 });
  expect(authConfig.trustHost).toBe(true);
  expect(authConfig).not.toHaveProperty('pages');
});
it('lists the default callback path without making a Google call', async () => {
  vi.stubEnv('AUTH_GOOGLE_ID', 'fake-client'); vi.stubEnv('AUTH_GOOGLE_SECRET', 'fake-secret'); vi.stubEnv('AUTH_SECRET', 'fake-auth-secret');
  const result = await handlers.GET(new NextRequest('https://example.test/api/auth/providers'));
  expect(await result.json()).toMatchObject({ google: { callbackUrl: 'https://example.test/api/auth/callback/google', signinUrl: 'https://example.test/api/auth/signin/google' } });
});
it('loads without Google credentials and refuses sign in with a worded error', async () => {
  vi.stubEnv('AUTH_GOOGLE_ID', ''); vi.stubEnv('AUTH_GOOGLE_SECRET', ''); vi.stubEnv('AUTH_SECRET', '');
  const result = await handlers.POST(new NextRequest('https://example.test/api/auth/signin/google', { method: 'POST' }));
  const callback = await handlers.GET(new NextRequest('https://example.test/api/auth/callback/google'));
  expect(callback.status).toBe(503);
  expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ error: { message: 'Google sign in is not configured yet.' } });
  const providers = await handlers.GET(new NextRequest('https://example.test/api/auth/providers'));
  expect(await providers.json()).toMatchObject({ google: { callbackUrl: 'https://example.test/api/auth/callback/google' } });
  await expect(signIn('google')).rejects.toThrow('Google sign in is not configured yet.');
});
