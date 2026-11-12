import { expect, it, vi } from 'vitest';
import { discoverA2A, sendA2A, type A2AInterface } from '../../src/server/connect/a2a';
import { callExternalAgent, type ExternalRow } from '../../src/server/settings/external-agent';
import { sealKey } from '../../src/server/settings/agent-settings';
import { mapError } from '../../src/server/http/errors';
import type { PinnedRequestInit } from '../../src/server/settings/net-guard';
const cardUrl = 'https://agent.example.com/.well-known/agent-card.json';
const url = 'https://agent.example.com/a2a';
const resolve = vi.fn(async () => [{ address: '93.184.215.14' }]);
const card = (version: '1.0' | '0.3' = '1.0', transport = 'JSONRPC') => ({ name: 'City Help Desk', skills: [{ id: 'complaints', name: 'Complaints' }],
  ...(version === '1.0' ? { supportedInterfaces: [{ url, protocolBinding: transport, protocolVersion: version }] } : { url, preferredTransport: transport, protocolVersion: '0.3.0' }) });
const iface: A2AInterface = { url, transport: 'JSONRPC', version: '1.0' };
const json = (value: unknown) => async () => Response.json(value);
const immediate = { message: { role: 'ROLE_AGENT', parts: [{ text: 'Hello Omar' }] } };
const task = (state: string, extra = {}) => ({ task: { id: 'task-1', status: { state }, ...extra } });

it.each(['1.0', '0.3'] as const)('normalizes %s cards and drops arbitrary metadata and credentials', async (version) => {
  const result = await discoverA2A(cardUrl, {}, { resolve, fetcher: json({ ...card(version), credentials: 'do not retain', instructions: 'do not retain' }) });
  expect(result).toEqual({ card: { name: 'City Help Desk', skills: [{ id: 'complaints', name: 'Complaints' }] }, iface: { url, transport: 'JSONRPC', version } });
});
it('chooses a supported interface when gRPC is preferred', async () => {
  const value = { ...card(), supportedInterfaces: [{ url, protocolBinding: 'GRPC', protocolVersion: '1.0' }, { url, protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }] };
  expect((await discoverA2A(cardUrl, {}, { resolve, fetcher: json(value) })).iface.transport).toBe('HTTP+JSON');
});
it.each(['1.0', '0.3'] as const)('uses the %s JSONRPC wire contract for immediate replies', async (version) => {
  const fetcher = vi.fn(async (_url: string, init: PinnedRequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(body.method).toBe(version === '1.0' ? 'SendMessage' : 'message/send');
    expect(body.params.message.role).toBe(version === '1.0' ? 'ROLE_USER' : 'user');
    expect(body.params.message.parts[0].text).toBe('Hi');
    expect(init.redirect).toBe('manual'); expect(init.rejectUnauthorized).toBe(true);
    return Response.json({ jsonrpc: '2.0', id: body.id, result: version === '1.0' ? immediate : { kind: 'message', parts: [{ kind: 'text', text: 'Hello Omar' }] } });
  });
  expect(await sendA2A({ ...iface, version }, cardUrl, 'Hi', 'session', {}, { resolve, fetcher })).toBe('Hello Omar');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['JSONRPC', 'HTTP+JSON'] as const)('polls Task then GetTask through the pinned %s binding', async (transport) => {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const dns = vi.fn(async () => [{ address: '93.184.215.14' }]);
  const fetcher = async (requestUrl: string, init: PinnedRequestInit) => {
    calls.push({ url: requestUrl, method: init.method!, body: init.body ? JSON.parse(String(init.body)) : {} });
    const value = calls.length === 1 ? task('TASK_STATE_WORKING') : task('TASK_STATE_COMPLETED', { artifacts: [{ parts: [{ text: 'Done' }] }] });
    return Response.json(transport === 'JSONRPC' ? { result: value } : value);
  };
  expect(await sendA2A({ ...iface, transport }, cardUrl, 'Hi', 'session', {}, { resolve: dns, fetcher })).toBe('Done');
  expect(dns).toHaveBeenCalledTimes(2);
  if (transport === 'JSONRPC') expect(calls[1]!.body).toMatchObject({ method: 'GetTask', params: { id: 'task-1' } });
  else { expect(calls[0]!.url).toBe(`${url}/message:send`); expect(calls[1]!.url).toBe(`${url}/tasks/task-1`); expect(calls[1]!.method).toBe('GET'); }
});
it.each(['input-required', 'auth-required'] as const)('reports %s safely and cancels the unfinished task', async (state) => {
  const methods: string[] = [];
  const fetcher = async (_url: string, init: PinnedRequestInit) => { const body = JSON.parse(String(init.body)); methods.push(body.method); return Response.json({ result: task(state) }); };
  await expect(sendA2A(iface, cardUrl, 'Hi', 's', {}, { resolve, fetcher })).rejects.toMatchObject({ code: state === 'input-required' ? 'external_needs_input' : 'external_needs_auth' });
  expect(methods).toEqual(['SendMessage', 'CancelTask']);
});
it('bounds polling and cancels through the same guarded interface', async () => {
  const methods: string[] = [];
  const fetcher = async (_url: string, init: PinnedRequestInit) => { methods.push(JSON.parse(String(init.body)).method); return Response.json({ result: task('working') }); };
  await expect(sendA2A(iface, cardUrl, 'Hi', 's', {}, { resolve, fetcher })).rejects.toMatchObject({ code: 'external_timeout' });
  expect(methods.filter((m) => m === 'GetTask')).toHaveLength(12); expect(methods.at(-1)).toBe('CancelTask');
});
it('reserves cancellation time when GetTask stalls and bounds the total deadline', async () => {
  const methods: string[] = [];
  const fetcher = async (_url: string, init: PinnedRequestInit) => {
    const method = JSON.parse(String(init.body)).method; methods.push(method);
    if (method === 'GetTask') return new Promise<Response>(() => {});
    return Response.json({ result: task('working') });
  };
  const start = Date.now();
  await expect(sendA2A(iface, cardUrl, 'Hi', 's', {}, { resolve, fetcher, timeoutMs: 800 })).rejects.toMatchObject({ code: 'external_timeout' });
  expect(Date.now() - start).toBeLessThan(1200); expect(methods).toContain('GetTask'); expect(methods.at(-1)).toBe('CancelTask');
});
it('times out card DNS, sends and response bodies without raw errors', async () => {
  for (const options of [
    { resolve: async () => new Promise<{ address: string }[]>(() => {}), fetcher: json(card()) },
    { resolve, fetcher: async () => new Promise<Response>(() => {}) },
    { resolve, fetcher: async () => new Response(new ReadableStream({ start() {} })) },
  ]) await expect(discoverA2A(cardUrl, {}, { ...options, timeoutMs: 20 })).rejects.toMatchObject({ code: 'external_timeout' });
});
it('refuses malformed, oversized, unsupported and mandatory extension cards', async () => {
  for (const value of [{}, { ...card(), skills: 'bad' }, { ...card(), name: '' }, card('1.0', 'GRPC'), { ...card(), capabilities: { extensions: [{ required: true }] } }]) {
    await expect(discoverA2A(cardUrl, {}, { resolve, fetcher: json(value) })).rejects.toHaveProperty('code');
  }
  for (const fetcher of [async () => new Response('not json'), json({ ...card(), ignored: 'x'.repeat(65536) })]) await expect(discoverA2A(cardUrl, {}, { resolve, fetcher })).rejects.toMatchObject({ code: 'external_format' });
});
it('refuses private cards and private advertised interfaces before sending a message', async () => {
  const fetcher = vi.fn(json(card()));
  await expect(discoverA2A('https://127.0.0.1/card', {}, { resolve, fetcher })).rejects.toMatchObject({ code: 'external_private_address' });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(discoverA2A(cardUrl, {}, { resolve, fetcher: json({ ...card(), supportedInterfaces: [{ url: 'https://private.example.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] }), })).resolves.toHaveProperty('iface');
  const privateDns = async (host: string) => [{ address: host === 'private.example.com' ? '10.0.0.1' : '93.184.215.14' }];
  await expect(discoverA2A(cardUrl, {}, { resolve: privateDns, fetcher: json({ ...card(), supportedInterfaces: [{ url: 'https://private.example.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] }) })).rejects.toMatchObject({ code: 'external_private_address' });
});
it('never forwards credentials to a card supplied different origin or redirect', async () => {
  const elsewhere = { ...card(), supportedInterfaces: [{ url: 'https://other.example.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] };
  await expect(discoverA2A(cardUrl, { header: 'Authorization', key: 'Bearer do-not-forward' }, { resolve, fetcher: json(elsewhere) })).rejects.toMatchObject({ code: 'external_safety' });
  const fetcher = vi.fn(json(immediate));
  await expect(sendA2A({ ...iface, url: 'https://other.example.com/a2a' }, cardUrl, 'Hi', 's', { header: 'X-Key', key: 'do-not-forward' }, { resolve, fetcher })).rejects.toMatchObject({ code: 'external_safety' });
  expect(fetcher).not.toHaveBeenCalled();
  for (const status of [301, 302, 307, 308]) await expect(discoverA2A(cardUrl, {}, { resolve, fetcher: async () => new Response(null, { status, headers: { location: 'https://127.0.0.1' } }) })).rejects.toMatchObject({ code: 'external_safety' });
});
it.each(['apiKey', 'bearer'] as const)('supports %s requirements, seals auth and redacts echo from evidence', async (type) => {
  const key = 'sample-secret-for-tests'; const auth = type === 'bearer' ? `Bearer ${key}` : key;
  const schema = type === 'apiKey' ? { apiKeySecurityScheme: { location: 'header', name: 'X-Key' } } : { httpAuthSecurityScheme: { scheme: 'Bearer' } };
  const discovery = await discoverA2A(cardUrl, {}, { resolve, fetcher: json({ ...card(), securitySchemes: { auth: schema }, securityRequirements: [{ schemes: { auth: { list: [] } } }] }) });
  expect(discovery.iface).toMatchObject({ authType: type, headerName: type === 'apiKey' ? 'X-Key' : 'Authorization' });
  const secret = 'server-test-secret-not-production';
  const row: ExternalRow = { revision: 'r', endpoint: url, format: 'a2a', card_url: cardUrl, a2a_interface: discovery.iface, header_name: discovery.iface.headerName!, key_cipher: sealKey(auth, secret), tested_at: null };
  const reply = await callExternalAgent(row, [{ role: 'user', content: 'Hi' }], 's', 'en', { resolve, secret, fetcher: async (_url, init) => { expect((init.headers as Record<string, string>)[row.header_name!]).toBe(auth); return Response.json({ result: { message: { parts: [{ text: `Hello ${auth} ${key}` }] } } }); } });
  expect(reply).not.toContain(key); expect(reply).toContain('[redacted]');
  const error = await callExternalAgent(row, [], 's', 'en', { resolve, secret, fetcher: async () => { throw new Error(auth); } }).catch((e) => e);
  expect(JSON.stringify(mapError(error))).not.toContain(key);
});
it('refuses OAuth and provides a safe authentication failure', async () => {
  await expect(discoverA2A(cardUrl, {}, { resolve, fetcher: json({ ...card(), securitySchemes: { oauth: { type: 'oauth2' } }, security: [{ oauth: [] }] }) })).rejects.toMatchObject({ code: 'external_unsupported' });
  await expect(sendA2A(iface, cardUrl, 'Hi', 's', {}, { resolve, fetcher: async () => new Response('secret', { status: 401 }) })).rejects.toMatchObject({ code: 'external_needs_auth' });
});

it('refuses credentials in an advertised URL and a stalled interface DNS lookup', async () => {
  for (const address of ['https://user:password@agent.example.com/a2a', 'https://agent.example.com/a2a?key=card-credential']) await expect(discoverA2A(cardUrl, {}, { resolve, fetcher: json({ ...card(), supportedInterfaces: [{ url: address, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] }) })).rejects.toHaveProperty('code');
  let calls = 0;
  await expect(discoverA2A(cardUrl, {}, { resolve: async () => ++calls === 1 ? [{ address: '93.184.215.14' }] : new Promise(() => {}), fetcher: json(card()), timeoutMs: 20 })).rejects.toMatchObject({ code: 'external_timeout' });
});
