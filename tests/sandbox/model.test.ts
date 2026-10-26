import { afterEach, expect, it, vi } from 'vitest';
import { openAiCompatibleModel } from '../../src/sandbox/openai-model';
import { toolManifest } from '../../src/sandbox/tools';
afterEach(() => vi.unstubAllGlobals());
it('maps tool calls and content and sends the expected request', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'one', function: { name: 'get_service_policy', arguments: '{}' } }] } }] }));
  vi.stubGlobal('fetch', fetchMock);
  const model = openAiCompatibleModel({ url: 'http://model.test', apiKey: 'secret', model: 'test', timeoutMs: 1000 });
  const result = await model({ messages: [{ role: 'assistant', content: null, tool_calls: [{ id: 'prior', name: 'get_service_policy', arguments: '{}' }] }], tools: toolManifest });
  expect(result).toEqual({ content: null, tool_calls: [{ id: 'one', name: 'get_service_policy', arguments: '{}' }] });
  const options = fetchMock.mock.calls[0]![1];
  expect(JSON.parse(options.body)).toMatchObject({ temperature: 0, max_tokens: 2000, model: 'test', messages: [{ tool_calls: [{ type: 'function', function: { name: 'get_service_policy', arguments: '{}' } }] }] });
  fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'Hello' } }] }));
  expect(await model({ messages: [], tools: toolManifest })).toEqual({ content: 'Hello' });
});
it('times out using the abort signal', async () => {
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason)); })));
  const model = openAiCompatibleModel({ url: 'http://model.test', model: 'test', timeoutMs: 10 });
  await expect(model({ messages: [], tools: toolManifest })).rejects.toThrow(/aborted|timeout/i);
});
it('rejects HTTP and malformed model responses', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValueOnce(Response.json({ choices: [] }));
  vi.stubGlobal('fetch', fetchMock);
  const model = openAiCompatibleModel({ url: 'http://model.test', model: 'test', timeoutMs: 1000 });
  await expect(model({ messages: [], tools: toolManifest })).rejects.toThrow('Model request failed');
  await expect(model({ messages: [], tools: toolManifest })).rejects.toThrow('Invalid model response');
});
