import { expect, it } from 'vitest';
import { callExternalAgent, type ExternalRow } from '../../src/server/settings/external-agent';
import { sealKey } from '../../src/server/settings/agent-settings';
import { safeAuthHeader } from '../../src/server/connect/a2a';
const secret = 'identity-transport-test-secret';
const global = 'global-token-123456', identity = 'person-A-<token>-123456';
const row: ExternalRow = { revision: crypto.randomUUID(), endpoint: 'https://agent.example.com/chat', format: 'simple_json', header_name: 'X-Api-Key', key_cipher: sealKey(global, secret), tested_at: new Date().toISOString() };
const resolve = async () => [{ address: '93.184.215.14' }];
const test = { workspaceId: crypto.randomUUID(), session: 'ses_' + 'a'.repeat(32), turn: 1, mode: 'security' as const };
it('preserves global auth on a different identity header and redacts both credentials before stripping markup', async () => {
  const reply = await callExternalAgent(row, [{ role: 'user', content: 'My case' }], test.session, 'en', { secret, resolve, test, identity: { header: 'Authorization', value: identity }, fetcher: async (_url, init) => {
    const headers = new Headers(init.headers); expect(headers.get('x-api-key')).toBe(global); expect(headers.get('authorization')).toBe(identity); expect(headers.get('x-nazir-mode')).toBe('security');
    return Response.json({ reply: `Credentials ${global} and ${identity}` });
  } });
  expect(reply).toBe('Credentials [redacted] and [redacted]');
});
it('replaces the same auth header case insensitively, even without an original saved key', async () => {
  for (const key_cipher of [row.key_cipher, null]) await callExternalAgent({ ...row, key_cipher }, [{ role: 'user', content: 'My case' }], test.session, 'ar', { secret, resolve, test, identity: { header: 'x-api-key', value: identity }, fetcher: async (_url, init) => {
    expect(new Headers(init.headers).get('x-api-key')).toBe(identity); return Response.json({ reply: 'Hello' });
  } });
});
it('never lets connection auth or a test identity replace containment and signature headers', async () => {
  for (const header of ['X-Nazir-Mode', 'x-nazir-signature', 'X-Nazir-Session', 'Traceparent', 'Baggage', 'A2A-Version']) {
    expect(safeAuthHeader(header)).toBe(false);
    await expect(callExternalAgent(row, [{ role: 'user', content: 'Hi' }], test.session, 'en', { secret, resolve, test, identity: { header, value: identity } })).rejects.toMatchObject({ code: 'external_safety' });
    await expect(callExternalAgent({ ...row, header_name: header }, [{ role: 'user', content: 'Hi' }], test.session, 'en', { secret, resolve, test })).rejects.toMatchObject({ code: 'external_safety' });
  }
});
it('refuses identities outside security mode and never bypasses the private host guard', async () => {
  await expect(callExternalAgent(row, [], test.session, 'en', { secret, resolve, identity: { header: 'Authorization', value: identity } })).rejects.toMatchObject({ code: 'external_safety' });
  await expect(callExternalAgent(row, [{ role: 'user', content: 'Hi' }], test.session, 'en', { secret, resolve: async () => [{ address: '127.0.0.1' }], test, identity: { header: 'Authorization', value: identity } })).rejects.toMatchObject({ code: 'external_private_address' });
});

it('carries identities and global auth through the guarded A2A adapter and redacts both tokens', async () => {
  for (const header of ['Authorization', 'x-api-key']) {
    const reply = await callExternalAgent({ ...row, format: 'a2a', card_url: 'https://agent.example.com/card', a2a_interface: { url: row.endpoint, transport: 'JSONRPC', version: '1.0' } }, [{ role: 'user', content: 'My case' }], test.session, 'en', { secret, resolve, test, identity: { header, value: identity }, fetcher: async (_url, init) => {
      const headers = new Headers(init.headers);
      expect(headers.get(header)).toBe(identity);
      if (header === 'Authorization') expect(headers.get('x-api-key')).toBe(global);
      expect(headers.get('x-nazir-mode')).toBe('security');
      return Response.json({ result: { message: { role: 'ROLE_AGENT', parts: [{ text: `Credentials ${global} and ${identity}` }] } } });
    } });
    expect(reply).toBe('Credentials [redacted] and [redacted]');
  }
});
