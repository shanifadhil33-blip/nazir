import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ request: mock.request }));
import { mcpRequest } from '../../src/server/agent/mcp-client';
import { callOwnModelFull } from '../../src/server/settings/own-model';
import { networkChatModel } from '../../src/server/runner/network-model';
import type { TransactionDriver } from '../../src/server/db/driver';
import type { ModelContext } from '../../src/server/runner/worker';

const own = { provider: 'custom' as const, baseUrl: 'https://model.example.com/v1', model: 'm', key: 'fixture' };
const request = { purpose: 'agent' as const, task: 'test_run' as const, messages: [{ role: 'user' as const, content: 'Hello' }] };
beforeEach(() => { mock.request.mockReset(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unpinned fetch refused by test'); })); });
afterEach(() => { vi.unstubAllGlobals(); });

function socket(status = 200) {
  const addresses: string[] = [];
  mock.request.mockImplementation((url: string, options: RequestOptions, receive: (res: IncomingMessage) => void) => {
    expect(options).toMatchObject({ servername: new URL(url).hostname, rejectUnauthorized: true, agent: false });
    expect(options.headers).not.toHaveProperty('host');
    for (let i = 0; i < 2; i++) options.lookup!(new URL(url).hostname, {}, (_error, address) => { addresses.push(String(address)); });
    const stream = new PassThrough();
    const res = Object.assign(stream, { statusCode: status, headers: { 'content-type': 'application/json', location: 'https://inward.example.com' } }) as unknown as IncomingMessage;
    return Object.assign(new EventEmitter(), { end: (text: string) => {
      const body = JSON.parse(text);
      receive(res);
      stream.end(JSON.stringify(body.jsonrpc ? { jsonrpc: '2.0', id: body.id, result: { tools: [] } } : { choices: [{ message: { content: 'Hello' } }] }));
    } }) as ClientRequest;
  });
  return addresses;
}

it.each(['mcp', 'own', 'runner'] as const)('pins every %s socket without resolving a rebinding hostname again', async (path) => {
  const resolve = vi.fn().mockResolvedValueOnce([{ address: '93.184.215.14' }]).mockResolvedValue([{ address: '127.0.0.1' }]);
  const used = socket();
  if (path === 'mcp') expect(await mcpRequest('https://mcp.example.com/mcp', 'tools/list', {}, { resolve })).toEqual({ tools: [] });
  else if (path === 'own') expect(await callOwnModelFull(own, request, undefined, resolve)).toEqual({ content: 'Hello' });
  else {
    const context = { workspaceId: 'w', conversationId: 'c', reserveCall: async () => {}, remainingMs: () => 30000, onCall: () => {} } as unknown as ModelContext;
    const runner = networkChatModel({} as TransactionDriver, context, { own: Promise.resolve(own), resolve, env: {} });
    expect(await runner.model({ messages: request.messages, tools: [] })).toEqual({ content: 'Hello' });
  }
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(used.length).toBeGreaterThan(0);
  expect(used.every((address) => address === '93.184.215.14')).toBe(true);
});

it.each(['mcp', 'own'] as const)('does not follow %s redirects', async (path) => {
  socket(302);
  const resolve = vi.fn(async () => [{ address: '93.184.215.14' }]);
  if (path === 'mcp') await expect(mcpRequest('https://mcp.example.com', 'tools/list', {}, { resolve })).rejects.toThrow('mcp_http_302');
  else expect(await callOwnModelFull(own, request, undefined, resolve)).toBeNull();
  expect(mock.request).toHaveBeenCalledTimes(1);
  expect(resolve).toHaveBeenCalledTimes(1);
});

it.each(['mcp', 'own'] as const)('refuses mixed public and private DNS answers for %s before opening a socket', async (path) => {
  const resolve = async () => [{ address: '93.184.215.14' }, { address: '10.0.0.1' }];
  if (path === 'mcp') await expect(mcpRequest('https://mcp.example.com', 'tools/list', {}, { resolve })).rejects.toThrow('blocked_address');
  else expect(await callOwnModelFull(own, request, undefined, resolve)).toBeNull();
  expect(mock.request).not.toHaveBeenCalled();
});

it('pins A2A card discovery and message sockets without global fetch or DNS rebinding', async () => {
  const { discoverA2A, sendA2A } = await import('../../src/server/connect/a2a');
  const checked: string[] = [];
  const resolve = vi.fn(async () => [{ address: '93.184.215.14' }]);
  mock.request.mockImplementation((url: string, options: RequestOptions, receive: (res: IncomingMessage) => void) => {
    expect(options).toMatchObject({ servername: 'agent.example.com', rejectUnauthorized: true, agent: false });
    for (let i = 0; i < 2; i++) options.lookup!('agent.example.com', {}, (_error, address) => checked.push(String(address)));
    const stream = new PassThrough();
    const res = Object.assign(stream, { statusCode: 200, headers: { 'content-type': 'application/json' } }) as unknown as IncomingMessage;
    return Object.assign(new EventEmitter(), { end: (data?: string) => { receive(res); stream.end(JSON.stringify(data ? { result: { message: { parts: [{ text: 'Hello Omar' }] } } } : { name: 'City Help Desk', skills: [], supportedInterfaces: [{ url: 'https://agent.example.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] })); } }) as ClientRequest;
  });
  const cardUrl = 'https://agent.example.com/card';
  const found = await discoverA2A(cardUrl, {}, { resolve });
  expect(await sendA2A(found.iface, cardUrl, 'Hello', 's', {}, { resolve })).toBe('Hello Omar');
  expect(mock.request).toHaveBeenCalledTimes(2); expect(checked).toEqual(Array(4).fill('93.184.215.14'));
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
