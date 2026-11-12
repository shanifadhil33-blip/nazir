import { afterEach, expect, it, vi } from 'vitest';
import { POST as simple } from '../../src/app/api/sandbox/agent/sample/route';
import { POST as a2a } from '../../src/app/api/sandbox/agent/a2a/route';
import { GET as card } from '../../src/app/api/sandbox/agent/.well-known/agent-card.json/route';
import { POST as protectedAgent } from '../../src/app/api/sandbox/agent/route';
import { callExternalAgent } from '../../src/server/settings/external-agent';
import { discoverA2A } from '../../src/server/connect/a2a';
import { sampleReply } from '../../src/server/connect/sample-agent';
const request = (body: unknown, address = crypto.randomUUID()) => new Request('https://nazir.example/api/sandbox/agent/sample', { method: 'POST', headers: { 'x-forwarded-for': address }, body: JSON.stringify(body) });
afterEach(() => vi.unstubAllEnvs());
it('accepts the public simple contract and rejects tenant or privileged settings without storage calls', async () => {
  const input = { message: 'Hello Omar', session_id: 'session', language: 'en' };
  const response = await simple(request(input)); expect(response.status).toBe(200); expect(await response.json()).toEqual({ reply: sampleReply(input.message, 'en') });
  for (const extra of [{ tenant: 'someone-else' }, { requester_key: 'another-person' }, { version: 'repair' }, { model: 'paid' }, { settings: {} }]) expect((await simple(request({ ...input, ...extra }))).status).toBe(400);
  const first = await simple(request({ message: 'Save a complaint for Omar' }));
  const second = await simple(request({ message: 'What did Omar save?' }));
  expect(JSON.stringify(await first.json())).toContain('does not save'); expect(JSON.stringify(await second.json())).not.toContain('Save a complaint for Omar');
});
it('advertises the actual public A2A path and real skills without SDK or credentials', async () => {
  vi.stubEnv('AUTH_URL', 'https://nazir.example');
  const response = await card(new Request('https://nazir.example/api/sandbox/agent/.well-known/agent-card.json', { headers: { 'x-forwarded-for': crypto.randomUUID() } }));
  const body = await response.json();
  expect(body.supportedInterfaces).toEqual([{ url: 'https://nazir.example/api/sandbox/agent/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
  expect(body.skills.map((s: { id: string }) => s.id)).toEqual(['complaints', 'suggestions', 'information']);
  expect(JSON.stringify(body)).not.toMatch(/SDK|secret|token|credential/i);
});
it('connects and sends a message through the actual public simple and A2A contracts', async () => {
  vi.stubEnv('AUTH_URL', 'https://nazir.example');
  const resolve = async () => [{ address: '93.184.215.14' }];
  const fetcher: NonNullable<Parameters<typeof callExternalAgent>[4]>['fetcher'] = async (url, init) => {
    const req = new Request(url, { method: init.method, headers: { ...init.headers, 'x-forwarded-for': crypto.randomUUID() }, body: init.body as string | undefined });
    return url.endsWith('agent-card.json') ? card(req) : url.endsWith('a2a') ? a2a(req) : simple(req);
  };
  const base = { revision: 'r', endpoint: 'https://nazir.example/api/sandbox/agent/sample', format: 'simple_json' as const, header_name: null, key_cipher: null, tested_at: null };
  expect(await callExternalAgent(base, [{ role: 'user', content: 'Hello' }], 's', 'en', { resolve, fetcher })).toBe(sampleReply('Hello', 'en'));
  const cardUrl = 'https://nazir.example/api/sandbox/agent/.well-known/agent-card.json';
  const found = await discoverA2A(cardUrl, {}, { resolve, fetcher });
  expect(await callExternalAgent({ ...base, format: 'a2a', endpoint: found.iface.url, card_url: cardUrl, a2a_interface: found.iface }, [{ role: 'user', content: 'مرحبا' }], 's', 'ar', { resolve, fetcher })).toBe(sampleReply('مرحبا', 'ar'));
});
it('rate limits one caller, bounds input and preserves authentication on the protected route', async () => {
  const ip = crypto.randomUUID();
  for (let i = 0; i < 60; i++) expect((await simple(request({ message: 'Hello' }, ip))).status).toBe(200);
  expect((await simple(request({ message: 'Hello' }, ip))).status).toBe(429);
  expect((await simple(request({ message: 'x'.repeat(11000) }))).status).toBe(400);
  vi.stubEnv('SANDBOX_AGENT_TOKEN', 'test-only-protected-token');
  expect((await protectedAgent(request({}))).status).toBe(401);
  vi.stubEnv('SANDBOX_AGENT_TOKEN', '');
  expect((await protectedAgent(request({}))).status).toBe(404);
});
