import { expect, it } from 'vitest';
import { sameOrigin, proxy, config } from '../../src/proxy';
import { NextRequest } from 'next/server';

it('lets reads and same site changes through', () => {
  expect(sameOrigin('GET', 'nazir.test', 'https://evil.example', 'cross-site')).toBe(true);
  expect(sameOrigin('POST', 'nazir.test', 'https://nazir.test', 'same-origin')).toBe(true);
  expect(sameOrigin('PUT', 'nazir.test', null, 'none')).toBe(true);
  expect(sameOrigin('POST', 'nazir.test', null, null)).toBe(true);
});
it('refuses a change that comes from another site', () => {
  expect(sameOrigin('POST', 'nazir.test', 'https://evil.example', 'cross-site')).toBe(false);
  expect(sameOrigin('POST', 'nazir.test', null, 'cross-site')).toBe(false);
  expect(sameOrigin('DELETE', 'nazir.test', null, 'same-site')).toBe(false);
  expect(sameOrigin('POST', 'nazir.test', 'https://evil.example', null)).toBe(false);
  expect(sameOrigin('POST', 'nazir.test', 'not a url', null)).toBe(false);
  expect(sameOrigin('POST', 'nazir.test', 'https://nazir.test.evil.example', null)).toBe(false);
});
it('answers 403 json from the proxy and only guards the workspace routes', async () => {
  const bad = proxy(new NextRequest('https://nazir.test/api/workspaces/x/reports', { method: 'POST', headers: { origin: 'https://evil.example', host: 'nazir.test' } }));
  expect(bad.status).toBe(403);
  expect((await bad.json()).error.code).toBe('forbidden');
  const ok = proxy(new NextRequest('https://nazir.test/api/workspaces/x/reports', { method: 'POST', headers: { origin: 'https://nazir.test', host: 'nazir.test' } }));
  expect(ok.status).toBe(200);
  expect(config.matcher).toEqual(['/api/workspaces', '/api/workspaces/:path*']);
});
