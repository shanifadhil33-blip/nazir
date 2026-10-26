import { afterEach, expect, it, vi } from 'vitest';
import { openAiCompatibleModel } from '../../src/sandbox/openai-model';
import { createAiChain } from '../../src/server/ai/chain';
import { memoryAiStore } from '../../src/server/ai/store';
import { chainChatModel } from '../../src/server/ai/chat-model';
import { networkChatModel } from '../../src/server/runner/network-model';
import { toolManifest } from '../../src/sandbox/tools';

const cutOff = 'عذراً، طلبك OR1004 تم تسليمه في 11 سبتمبر 20';
afterEach(() => vi.unstubAllGlobals());
it.each(['length', 'stop', undefined])('sandbox adapter preserves finish reason %s as a truncation flag', async (finish_reason) => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason, message: { content: cutOff } }] }));
  vi.stubGlobal('fetch', fetcher);
  const model = openAiCompatibleModel({ url: 'https://fixture.invalid', model: 'fixture', timeoutMs: 1000 });
  const reply = await model({ messages: [], tools: toolManifest });
  expect(reply).toEqual({ content: cutOff, ...(finish_reason === 'length' ? { truncated: true } : {}) });
  expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string).max_tokens).toBe(2000);
});
it.each(['length', 'stop', undefined])('live chain and both runner adapters preserve finish reason %s', async (finish_reason) => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason, message: { content: cutOff } }] }));
  const chain = createAiChain({ fetch: fetcher, store: memoryAiStore(), env: {}, now: () => 0, sleep: async () => {} });
  const wrapped = chainChatModel(chain, { task: 'test_run' });
  const request = { messages: [], tools: toolManifest };
  expect(await wrapped(request)).toEqual({ content: cutOff, ...(finish_reason === 'length' ? { truncated: true } : {}) });
  const network = networkChatModel({} as never, { workspaceId: 'fixture', conversationId: 'fixture', onCall: () => {}, reserveCall: async () => {}, remainingMs: () => 10000 }, { fetch: fetcher, store: memoryAiStore(), own: Promise.resolve(null), env: {}, now: () => 1, sleep: async () => {} });
  expect(await network.model(request)).toEqual({ content: cutOff, ...(finish_reason === 'length' ? { truncated: true } : {}) });
  for (const [, init] of fetcher.mock.calls) expect(JSON.parse(init!.body as string).max_tokens).toBe(2000);
});
it('sandbox adapter surfaces a length finish even without visible content', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: null } }] }));
  vi.stubGlobal('fetch', fetcher);
  const model = openAiCompatibleModel({ url: 'https://fixture.invalid', model: 'fixture', timeoutMs: 1000 });
  expect(await model({ messages: [], tools: toolManifest })).toEqual({ content: null, truncated: true });
});
it.each([null, '', '   ', undefined])('chain fails over on empty length-limited content %s', async (content) => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: 'length', message: { content, tool_calls: [] } }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'Complete reply' } }] }));
  const chain = createAiChain({ fetch: fetcher, store: memoryAiStore(), env: { REQUESTY_API_KEY: 'fixture' }, now: () => 0, sleep: async () => {} });
  const result = await chain.chat({ purpose: 'agent', task: 'test_run', messages: [] });
  expect(result.content).toBe('Complete reply');
  expect(result).not.toHaveProperty('truncated');
  expect(result.meta).toMatchObject({ provider: 'requesty', failover: true, failoverReason: 'invalid_response' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('chain preserves truncation on a tool-only reply', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: 'length', message: {
    tool_calls: [{ id: 'one', type: 'function', function: { name: 'get_service_policy', arguments: '{}' } }],
  } }] }));
  const chain = createAiChain({ fetch: fetcher, store: memoryAiStore(), env: {}, now: () => 0, sleep: async () => {} });
  expect(await chainChatModel(chain, { task: 'test_run' })({ messages: [], tools: toolManifest })).toEqual({
    content: null, truncated: true, tool_calls: [{ id: 'one', name: 'get_service_policy', arguments: '{}' }],
  });
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['sandbox', 'chain'] as const)('%s strips truncation metadata from every outgoing transcript message', async (adapter) => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: 'Complete reply' } }] }));
  vi.stubGlobal('fetch', fetcher);
  const model = adapter === 'sandbox'
    ? openAiCompatibleModel({ url: 'https://fixture.invalid', model: 'fixture', timeoutMs: 1000 })
    : chainChatModel(createAiChain({ fetch: fetcher, store: memoryAiStore(), env: {}, now: () => 0, sleep: async () => {} }), { task: 'test_run' });
  const messages = [
    { role: 'assistant' as const, content: cutOff, truncated: true as const },
    { role: 'assistant' as const, content: null, truncated: true as const, tool_calls: [{ id: 'one', name: 'get_service_policy', arguments: '{}' }] },
    { role: 'tool' as const, content: '{}', tool_call_id: 'one' },
  ];
  await model({ messages, tools: toolManifest });
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).messages).toEqual([
    { role: 'assistant', content: cutOff },
    { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'get_service_policy', arguments: '{}' } }] },
    { role: 'tool', content: '{}', tool_call_id: 'one' },
  ]);
  expect(messages[0]!.truncated).toBe(true);
  expect(messages[1]!.truncated).toBe(true);
});
