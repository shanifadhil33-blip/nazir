import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ request: mock.request }));
import { callExternalAgent, type ExternalRow } from '../../src/server/settings/external-agent';
import { checkedHttpsAddress, pinnedLookup } from '../../src/server/settings/net-guard';
import { errorLines, mapError } from '../../src/server/http/errors';
const row: ExternalRow = { endpoint: 'https://agent.example.com/chat', revision: 'r', format: 'simple_json', header_name: null, key_cipher: null, tested_at: null };

it('pins the actual HTTPS lookup to the first checked IP while preserving hostname and TLS validation', async () => {
  const resolve = vi.fn().mockResolvedValueOnce([{ address: '93.184.215.14' }]).mockResolvedValue([{ address: '127.0.0.1' }]);
  const used: string[] = [];
  mock.request.mockImplementation((url: string, options: RequestOptions, receive: (r: IncomingMessage) => void) => {
    expect(url).toBe(row.endpoint);
    expect(options).toMatchObject({ servername: 'agent.example.com', rejectUnauthorized: true, agent: false });
    expect(options.headers).not.toHaveProperty('host'); // Native HTTPS builds Host from the original URL.
    for (let i = 0; i < 2; i++) options.lookup!('agent.example.com', {}, (_err, address) => { used.push(String(address)); });
    const stream = new PassThrough();
    const res = Object.assign(stream, { statusCode: 200, headers: { 'content-type': 'application/json' } }) as unknown as IncomingMessage;
    const req = Object.assign(new EventEmitter(), { end: () => { receive(res); stream.end('{"reply":"Hello"}'); } });
    return req as ClientRequest;
  });
  expect(await callExternalAgent(row, [], 's', 'en', { resolve })).toBe('Hello');
  expect(resolve).toHaveBeenCalledExactlyOnceWith('agent.example.com');
  expect(used).toEqual(['93.184.215.14', '93.184.215.14']);
});

it('pins IPv6 answers and supports the all addresses lookup callback without another resolution', async () => {
  const lookup = pinnedLookup(await checkedHttpsAddress(row.endpoint, async () => [{ address: '2606:4700:4700::1111' }]));
  lookup('agent.example.com', { all: true }, (error, addresses) => {
    expect(error).toBeNull(); expect(addresses).toEqual([{ address: '2606:4700:4700::1111', family: 6 }]);
  });
});

it.each(['https://127.0.0.1', 'https://[::1]', 'https://localhost.', 'https://desk.local', row.endpoint])('refuses private or local targets with clear EN and AR messages: %s', async (endpoint) => {
  const fetcher = vi.fn();
  const error = await callExternalAgent({ ...row, endpoint }, [], 's', 'ar', { resolve: async () => [{ address: '93.184.215.14' }, { address: '10.0.0.1' }], fetcher }).catch((e: unknown) => e);
  for (const language of ['en', 'ar'] as const) expect(mapError(error, language).body.error).toEqual({ code: 'external_private_address', message: errorLines.external_private_address[language] });
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps checked connections public even when the legacy development DNS flag is enabled', async () => {
  vi.stubEnv('NAZIR_ALLOW_BENCHMARK_DNS', '1');
  try {
    await expect(checkedHttpsAddress(row.endpoint, async () => [{ address: '198.18.0.1' }])).rejects.toMatchObject({ code: 'external_private_address' });
    await expect(checkedHttpsAddress('https://198.19.0.1')).rejects.toMatchObject({ code: 'external_private_address' });
  } finally { vi.unstubAllEnvs(); }
});

it('revalidates A2A DNS for polling and refuses a rebound address before the second send', async () => {
  const { sendA2A } = await import('../../src/server/connect/a2a');
  const resolve = vi.fn().mockResolvedValueOnce([{ address: '93.184.215.14' }]).mockResolvedValue([{ address: '10.0.0.1' }]);
  const fetcher = vi.fn(async () => Response.json({ result: { task: { id: 't', status: { state: 'working' } } } }));
  await expect(sendA2A({ url: row.endpoint, transport: 'JSONRPC', version: '1.0' }, row.endpoint, 'Hello', 's', {}, { resolve, fetcher })).rejects.toMatchObject({ code: 'external_private_address' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
