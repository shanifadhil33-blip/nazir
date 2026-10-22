import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { saveExternalAgent, readExternalAgent, removeExternalAgent, testExternalAgent, callExternalAgent, type ExternalRow } from '../../src/server/settings/external-agent';
import { safeHttpsUrl, sealKey } from '../../src/server/settings/agent-settings';
import { publicHttpsUrl, privateAddress } from '../../src/server/settings/net-guard';
import { Forbidden, mapError } from '../../src/server/http/errors';
const secret = 'external-agent-test-server-secret-12345';
const key = 'Bearer external-key-12345678wxyz';
const resolve = async () => [{ address: '93.184.215.14' }];
const input = { name: 'Customer desk', endpoint: 'https://chat.example.com/message', format: 'simple_json', header_name: 'Authorization', secret: key };
const row: ExternalRow = { revision: crypto.randomUUID(), endpoint: input.endpoint, format: 'simple_json', header_name: 'Authorization', key_cipher: sealKey(key, secret), tested_at: null };
const ok = (async () => Response.json({ reply: 'Hello' })) as typeof fetch;
let db: TestDatabase, owner: string, workspace: string, reviewer: string, viewer: string, other: string;
beforeAll(async () => {
  db = await testDatabase();
  const a = await db.bootstrap('External'); owner = a.member_id; workspace = a.workspace_id;
  reviewer = await db.createMember(workspace, ['quality_reviewer']); viewer = await db.createMember(workspace, ['viewer']);
  other = (await db.bootstrap('Other external')).member_id;
});
afterAll(async () => { await db?.close(); });
it('rejects unsafe protocols, ports, credentials, local names and literal addresses', async () => {
  for (const url of ['http://chat.example.com', 'https://chat.example.com:8443', 'https://u:p@chat.example.com', 'https://127.0.0.1', 'https://10.0.0.1', 'https://172.16.0.1', 'https://192.168.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://[fe80::1]', 'https://[fd00::1]', 'https://localhost', 'https://x.localhost', 'https://x.internal']) {
    expect(safeHttpsUrl(url), url).toBe(false);
    await expect(saveExternalAgent(db.driver, owner, { ...input, endpoint: url }, secret, resolve)).rejects.toThrow();
  }
  expect(safeHttpsUrl('https://chat.example.com:443/message')).toBe(true);
  expect(privateAddress('2001:4860:4860::8888')).toBe(false);
  expect(privateAddress('2606:4700:4700::1111')).toBe(false);
  for (const address of ['::ffff:7f00:1', '::ffff:127.0.0.1', '2002:7f00:1::', '192.0.0.8', '198.51.100.1', '203.0.113.1']) expect(privateAddress(address)).toBe(true);
  expect(await publicHttpsUrl(input.endpoint, async () => [{ address: '93.184.215.14' }, { address: '127.0.0.1' }])).toBe(false);
  await expect(saveExternalAgent(db.driver, owner, input, secret, async () => [{ address: '::1' }])).rejects.toMatchObject({ code: 'external_private_address' });
});
it('seals the key, projects only safe fields and audits no submitted details', async () => {
  const saved = await saveExternalAgent(db.driver, owner, input, secret, resolve);
  expect(saved).toMatchObject({ ready: false, key_saved: true, key_last4: 'wxyz' });
  expect(JSON.stringify(saved)).not.toContain(key);
  const raw = (await db.owner.query<{ key_cipher: string }>('SELECT key_cipher FROM nazir.external_agents WHERE workspace_id=$1', [workspace])).rows[0]!;
  expect(raw.key_cipher).not.toContain(key);
  for (const id of [reviewer, viewer]) {
    expect(await readExternalAgent(db.driver, id)).toEqual({ name: input.name, host: 'chat.example.com', ready: false });
    await expect(saveExternalAgent(db.driver, id, input, secret, resolve)).rejects.toBeInstanceOf(Forbidden);
    await expect(testExternalAgent(db.driver, id, { message: 'Hi', language: 'en' }, { fetcher: ok, resolve, secret })).rejects.toBeInstanceOf(Forbidden);
    await expect(removeExternalAgent(db.driver, id)).rejects.toBeInstanceOf(Forbidden);
    await expect(db.member(id, (sql) => sql.query('SELECT * FROM nazir.external_agents'))).rejects.toThrow(/permission denied/);
    await expect(db.member(id, (sql) => sql.query('SELECT * FROM nazir.external_agent_worker()'))).rejects.toThrow(/permission denied/);
  }
  expect(await readExternalAgent(db.driver, other)).toBeNull();
  const tested = await testExternalAgent(db.driver, owner, { message: 'Hi', language: 'en' }, { fetcher: (async () => Response.json({ reply: `<b>Hello</b> ${key}` })) as typeof fetch, resolve, secret });
  expect(tested).toEqual({ reply: 'Hello [redacted]', ready: true });
  const audits = (await db.owner.query("SELECT payload FROM nazir.audit_events WHERE action LIKE 'agent.connection%'")).rows;
  expect(audits.length).toBeGreaterThan(0);
  for (const value of [key, raw.key_cipher, input.endpoint, 'Hello', 'Hi']) expect(JSON.stringify(audits)).not.toContain(value);
  expect((await saveExternalAgent(db.driver, owner, { ...input, secret: undefined }, secret, resolve))?.ready).toBe(false);
  expect((await readExternalAgent(db.driver, owner))?.key_last4).toBe('wxyz');
});
it('refuses dangerous auth headers and control characters', async () => {
  for (const patch of [{ header_name: 'Host' }, { header_name: 'Content-Type' }, { header_name: 'Cookie' }, { header_name: 'Proxy-Authorization' }, { secret: 'bad\r\nvalue' }, { secret: 'four' }]) await expect(saveExternalAgent(db.driver, owner, { ...input, ...patch }, secret, resolve)).rejects.toThrow();
});
it('rechecks DNS before calls, refuses redirects, bad JSON and excessive bytes', async () => {
  const fetcher = vi.fn(ok);
  await expect(callExternalAgent(row, [], 's', 'en', { fetcher, resolve: async () => [{ address: '10.0.0.1' }], secret })).rejects.toMatchObject({ code: 'external_private_address' });
  expect(fetcher).not.toHaveBeenCalled();
  for (const response of [new Response('', { status: 302, headers: { location: 'https://127.0.0.1' } }), new Response('', { status: 307 })]) {
    await expect(callExternalAgent(row, [], 's', 'en', { fetcher: (async (_u, init) => { expect(init?.redirect).toBe('manual'); return response; }) as typeof fetch, resolve, secret })).rejects.toMatchObject({ code: 'external_safety' });
  }
  for (const response of [new Response('not json'), Response.json({ choices: [] }), Response.json({ reply: 'x'.repeat(65536) }), new Response('{}', { headers: { 'content-length': '65537' } })]) {
    await expect(callExternalAgent(row, [], 's', 'en', { fetcher: (async () => response) as typeof fetch, resolve, secret })).rejects.toMatchObject({ code: 'external_format' });
  }
  await expect(callExternalAgent(row, [], 's', 'en', { fetcher: (async () => { throw new Error(key); }) as typeof fetch, resolve, secret })).rejects.toMatchObject({ code: 'external_unreachable' });
});
it('times out both stalled fetch and a stalled response body', async () => {
  for (const fetcher of [(async () => new Promise<Response>(() => {})) as typeof fetch, (async () => new Response(new ReadableStream({ start() {} }))) as typeof fetch]) {
    const start = Date.now();
    await expect(callExternalAgent(row, [], 's', 'en', { fetcher, resolve, secret, timeoutMs: 20 })).rejects.toMatchObject({ code: 'external_timeout' });
    expect(Date.now() - start).toBeLessThan(1000);
  }
});
it('caps extracted plain text and never returns the full key even if the endpoint echoes it', async () => {
  expect((await callExternalAgent(row, [], 's', 'en', { resolve, secret, fetcher: (async () => Response.json({ reply: 'a'.repeat(9000) })) as typeof fetch })).length).toBe(8000);
  const error = await callExternalAgent(row, [], 's', 'en', { resolve, secret, fetcher: (async () => { throw new Error(key); }) as typeof fetch }).catch((e) => e);
  expect(JSON.stringify(mapError(error))).not.toContain(key);
  expect(mapError(error, 'ar').body.error.message).toMatch(/[\u0600-\u06ff]/);
});
it('limits test sends per workspace across owners and saves and localizes the refusal', async () => {
  await db.owner.query('DELETE FROM nazir.external_agent_limits');
  const secondOwner = await db.createMember(workspace, ['service_owner']);
  for (let i = 0; i < 20; i++) await testExternalAgent(db.driver, i % 2 ? secondOwner : owner, { message: 'Hi', language: 'en' }, { fetcher: ok, resolve, secret });
  await saveExternalAgent(db.driver, owner, input, secret, resolve);
  await expect(testExternalAgent(db.driver, owner, { message: 'Hi', language: 'ar' }, { fetcher: ok, resolve, secret })).rejects.toMatchObject({ status: 429, code: 'external_rate_limit' });
  expect(mapError(new (await import('../../src/server/http/errors')).Coded(429, 'external_rate_limit', ''), 'ar').body.error.message).toContain('20');
  await removeExternalAgent(db.driver, owner);
  expect(await readExternalAgent(db.driver, owner)).toBeNull();
});

it.each(['en', 'ar'] as const)('shows the same private address message for DNS refusal on save and test send in %s', async (language) => {
  const { errorLines } = await import('../../src/server/http/errors');
  const privateDns = async () => [{ address: '10.0.0.1' }];
  for (const endpoint of ['https://127.0.0.1/chat', input.endpoint]) {
    const error = await saveExternalAgent(db.driver, owner, { ...input, endpoint }, secret, privateDns).catch((e: unknown) => e);
    expect(mapError(error, language).body.error.message).toBe(errorLines.external_private_address[language]);
  }
  await db.owner.query('DELETE FROM nazir.external_agent_limits');
  await saveExternalAgent(db.driver, owner, input, secret, resolve);
  const fetcher = vi.fn(ok);
  const error = await testExternalAgent(db.driver, owner, { message: 'Hello', language }, { fetcher, resolve: privateDns, secret }).catch((e: unknown) => e);
  expect(mapError(error, language).body.error).toEqual({ code: 'external_private_address', message: errorLines.external_private_address[language] });
  expect(fetcher).not.toHaveBeenCalled();
});
