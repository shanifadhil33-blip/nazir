import { afterEach, expect, it, vi } from 'vitest';
import { AiChainExhausted, createAiChain, redactProviderText } from '../../src/server/ai/chain';
import { chainOrder, providerRegistry, type Env } from '../../src/server/ai/providers';
import { memoryAiStore } from '../../src/server/ai/store';
import { matchesSchema } from '../../src/server/ai/schema';
const env: Env = { REQUESTY_API_KEY: 'sk-fake-requesty-key', OPENROUTER_API_KEY: 'sk-fake-openrouter-key', ZAI_API_KEY: 'sk-fake-zai-key', CLOUDFLARE_ACCOUNT_ID: 'test-account', CLOUDFLARE_AI_TOKEN: 'sk-fake-cloudflare-key', GEMINI_API_KEY: 'sk-fake-gemini-key', NVIDIA_API_KEY: 'sk-fake-nvidia-key' };
const input = { purpose: 'agent' as const, task: 'test_run' as const, messages: [] };
const ok = () => Response.json({ choices: [{ message: { content: 'Hello' } }] });
function setup(responses: (Response | Error)[] = [], overrides: Env = {}, forcedDown = new Set<string>()) {
  let time = Date.UTC(2026,9,19);
  const now = () => time;
  const sleep = async (ms: number) => { time += ms; };
  const store = memoryAiStore(now);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { const response = responses.shift() ?? ok(); if (response instanceof Error) throw response; return response; });
  const chain = createAiChain({ fetch, store, now, sleep, env: { ...env, ...overrides }, forcedDown });
  return { chain, fetch, store, now, advance: (ms: number) => { time += ms; } };
}
afterEach(() => vi.useRealTimers());
it('answers with the first model and records its metadata', async () => {
  const { chain, store, fetch } = setup();
  const result = await chain.chat(input);
  expect(result.meta).toMatchObject({ provider: 'requesty', model: 'nvidia/nemotron-3-ultra-550b-a55b', failover: false, failoverReason: null });
  expect(store.records).toHaveLength(1); expect(store.records[0]).toMatchObject({ outcome: 'ok', attemptNo: 1, task: 'test_run' });
  expect(fetch).toHaveBeenCalledOnce();
});
it.each(['per day','per-day','daily','neurons','free-models-per-day','quota'])('cools a day used response mentioning %s for an hour', async (text) => {
  const s = setup([new Response(text,{ status:429 })]);
  const first = await s.chain.chat(input);
  expect(first.meta).toMatchObject({ provider: 'kilo', failover: true, failoverReason: 'day_used' });
  expect((await s.store.activeCooldowns())[0]!.until - s.now()).toBe(3600000);
  const second = await s.chain.chat(input); expect(second.meta.attempts[0]!.reason).toBe('cooling');
  s.advance(61 * 60000);
  expect((await s.chain.chat(input)).meta.provider).toBe('requesty');
});
it('cools an ordinary rate limit for sixty seconds', async () => {
  const s = setup([new Response('too many concurrent requests',{ status:429 })]);
  await s.chain.chat(input);
  expect((await s.store.activeCooldowns())[0]!.until - s.now()).toBe(60000);
  expect((await s.chain.chat(input)).meta.attempts[0]!.reason).toBe('cooling');
  s.advance(61000); expect((await s.chain.chat(input)).meta.provider).toBe('requesty');
});
it.each([402,401,403])('drops the whole provider for 24 hours on %s', async (status) => {
  const s = setup([new Response('refused',{ status })]);
  await s.chain.chat(input);
  expect(await s.store.activeCooldowns()).toMatchObject([{ provider: 'requesty', model: '*', until: s.now() + 86400000 }]);
  const judge = await s.chain.chat({ ...input, purpose: 'judge', agentFamily: 'google_gemini' });
  expect(judge.meta.attempts[0]).toMatchObject({ provider:'requesty', reason:'cooling' });
  s.advance(86400001); expect((await s.chain.chat(input)).meta.provider).toBe('requesty');
});
it.each([
  [new Response('bad',{ status:503 }), 'http_5xx'], [new Error('network'), 'network'], [new DOMException('time','TimeoutError'), 'timeout'],
  [Response.json({ choices:[{ message:{ content:'' } }] }), 'invalid_response'], [new Response('not json'),'invalid_response'],
  [Response.json({ choices:[] }),'invalid_response'], [Response.json({ choices:[{ message:{ content:9 } }] }),'invalid_response'],
  [Response.json({ choices:[{ message:{ content:null, tool_calls:{} } }] }),'invalid_response'],
])('moves on without cooldown for transient or malformed replies %#', async (response, reason) => {
  const s = setup([response]); const result = await s.chain.chat(input);
  expect(result.meta.provider).toBe('kilo'); expect(result.meta.failoverReason).toBe(reason); expect(await s.store.activeCooldowns()).toEqual([]);
});
it('skips missing credentials without fetching them', async () => {
  const s = setup([], { REQUESTY_API_KEY: undefined });
  expect((await s.chain.chat(input)).meta.attempts[0]!.reason).toBe('no_key');
  expect(s.fetch).toHaveBeenCalledOnce(); expect(s.fetch.mock.calls[0]![0]).toContain('kilo');
});
it('requires both Cloudflare credentials', async () => {
  const s = setup([], { CLOUDFLARE_ACCOUNT_ID: undefined }, new Set(['requesty','kilo','openrouter','ovh','zai']));
  const result = await s.chain.chat(input);
  expect(result.meta.attempts.find((a) => a.provider === 'cloudflare')!.reason).toBe('no_key'); expect(result.meta.provider).toBe('gemini');
});
it('supports provider and provider/model fault injection without network calls', async () => {
  const s = setup([], {}, new Set(['requesty','kilo/nvidia/nemotron-3-ultra-550b-a55b:free']));
  const result = await s.chain.chat(input);
  expect(result.meta.attempts.slice(0,2).map((a) => a.reason)).toEqual(['forced_down','forced_down']); expect(s.fetch).toHaveBeenCalledOnce();
  expect((await s.store.usageToday()).reduce((n,r) => n + r.calls,0)).toBe(1);
});
it('throws exhaustion with all ten attempts', async () => {
  const s = setup(Array.from({ length:10 }, () => new Response('bad',{ status:500 })));
  await expect(s.chain.chat(input)).rejects.toMatchObject({ name:'AiChainExhausted', attempts: expect.any(Array) });
  expect(s.store.records).toHaveLength(10); expect(s.fetch).toHaveBeenCalledTimes(10);
});
it('stops at the total deadline during a network call even when fetch ignores abort', async () => {
  vi.useFakeTimers(); const store = memoryAiStore();
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}));
  const chain = createAiChain({ fetch, store, env });
  const result = chain.chat({ ...input, deadlineMs: 20 }).catch((e) => e);
  await vi.advanceTimersByTimeAsync(21);
  expect(await result).toMatchObject({ attempts: [{ reason:'deadline', outcome:'error' }] }); expect(fetch).toHaveBeenCalledOnce();
});
it('uses provider timeout then tries the next model', async () => {
  vi.useFakeTimers(); const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(ok());
  const result = createAiChain({ fetch, store: memoryAiStore(), env }).chat(input);
  await vi.advanceTimersByTimeAsync(12001); expect((await result).meta.failoverReason).toBe('timeout');
});
const tools = [{ type:'function', function:{ name:'create_case', parameters:{ type:'object', properties:{ confirmed:{ type:'boolean' }, category:{ type:'string', enum:['complaint'] } }, required:['confirmed','category'], additionalProperties:false } } }];
const toolReply = (name: string, args: string) => Response.json({ choices:[{ message:{ content:null, tool_calls:[{ id:'one', type:'function', function:{ name, arguments:args } }] } }] });
it.each([
  ['create_case','{"confirmed":"true","category":"complaint"}'], ['missing','{}'], ['create_case','{'],
  ['create_case','{"confirmed":true,"category":"other"}'], ['create_case','{"confirmed":true,"category":"complaint","extra":1}'],
  ['create_case','{"confirmed":true}'],
])('rejects tool arguments and advances %#', async (name,args) => {
  const s = setup([toolReply(name,args)]);
  const result = await s.chain.chat({ ...input, tools }); expect(result.meta.failoverReason).toBe('invalid_tool_args'); expect(result.meta.provider).toBe('kilo');
});
it('accepts strict valid tool arguments and maps transcript calls to wire format', async () => {
  const s = setup([toolReply('create_case','{"confirmed":true,"category":"complaint"}')]);
  const result = await s.chain.chat({ ...input, tools, messages:[{ role:'assistant', content:null, tool_calls:[{ id:'old', name:'create_case', arguments:'{}' }] }] });
  expect(result.tool_calls![0]!.name).toBe('create_case');
  expect(JSON.parse(s.fetch.mock.calls[0]![1]!.body as string).messages[0].tool_calls[0]).toMatchObject({ type:'function', function:{ name:'create_case' } });
});
it('checks the schema subset including exact numbers, strings, nullable alternatives and inherited property names', () => {
  const check = matchesSchema;
  expect(check(null,{ anyOf:[{ type:'string' },{ type:'null' }] })).toBe(true);
  expect(check('ab',{ type:'string', minLength:2,maxLength:3,pattern:'^a' })).toBe(true);
  expect(check('a',{ type:'string',minLength:2 })).toBe(false); expect(check('abcd',{ type:'string',maxLength:3 })).toBe(false);
  expect(check('bb',{ type:'string',pattern:'^a' })).toBe(false);
  expect(check('1',{ type:'integer' })).toBe(false); expect(check(1.5,{ type:'integer' })).toBe(false); expect(check(1,{ type:'integer' })).toBe(true);
  expect(check(Infinity,{ type:'number' })).toBe(false); expect(check(1.5,{ type:'number' })).toBe(true);
  expect(check([], { type:'object' })).toBe(false); expect(check({ toString:1 },{ type:'object',properties:{},additionalProperties:false })).toBe(false);
});
it('applies caller validation without exposing arbitrary validation text', async () => {
  const s = setup(); let n = 0;
  const result = await s.chain.chat({ ...input,validate:() => ++n === 1 ? env.REQUESTY_API_KEY! : null });
  expect(result.meta.failoverReason).toBe('invalid_response'); expect(JSON.stringify(result.meta)).not.toContain(env.REQUESTY_API_KEY);
});
it('pins the agent order and excludes agent families and unknown models from judges', async () => {
  const providers = providerRegistry({});
  expect(chainOrder(providers,'agent').map((m) => `${m.provider.id}/${m.model}`)).toEqual([
    'requesty/nvidia/nemotron-3-ultra-550b-a55b','kilo/nvidia/nemotron-3-ultra-550b-a55b:free','openrouter/nvidia/nemotron-3-super-120b-a12b:free','ovh/gpt-oss-120b','ovh/Qwen3.5-397B-A17B','zai/glm-4.7-flash','cloudflare/@cf/openai/gpt-oss-120b','gemini/gemini-3.5-flash-lite','nvidia/nvidia/nemotron-3-super-120b-a12b','kilo/kilo-auto/free',
  ]);
  const judge = chainOrder(providers,'judge','nvidia_nemotron'); expect(judge.map((m) => m.provider.id)).toEqual(['gemini','requesty','ovh','zai','cloudflare']);
  for (const family of ['google_gemini','google_gemma','openai_gpt_oss','zhipu_glm','nvidia_nemotron'] as const) expect(chainOrder(providers,'judge',family).every((m) => m.family !== family && m.family !== 'unknown')).toBe(true);
  const s = setup(); await expect(s.chain.chat({ ...input,purpose:'judge' })).rejects.toThrow('family'); expect(s.fetch).not.toHaveBeenCalled();
});
it('allows only registry model overrides and preserves their assigned purpose', () => {
  expect(() => providerRegistry({ AI_MODELS_KILO:'paid-model' })).toThrow('refused');
  const p = providerRegistry({ AI_MODELS_REQUESTY:'google/gemma-4-31b-it', AI_MODELS_OVH:'Qwen3.5-397B-A17B' });
  expect(chainOrder(p,'agent').filter((m) => m.provider.id === 'requesty')).toEqual([]);
  expect(chainOrder(p,'agent').filter((m) => m.provider.id === 'ovh').map((m) => m.model)).toEqual(['Qwen3.5-397B-A17B']);
  expect(() => providerRegistry({ AI_PROVIDER_CAP_OVH:'-1' })).toThrow('cap');
});
it('rejects a reservation at task cap without reaching the network', async () => {
  const s = setup([], { AI_DAILY_CAP_TEST_RUN:'0' });
  await expect(s.chain.chat(input)).rejects.toBeInstanceOf(AiChainExhausted); expect(s.fetch).not.toHaveBeenCalled(); expect(s.store.records.every((r) => r.reason === 'cap_reached')).toBe(true);
});
it('advances past a provider cap', async () => {
  const s = setup([], { AI_PROVIDER_CAP_REQUESTY:'0' }); const r = await s.chain.chat(input); expect(r.meta.failoverReason).toBe('cap_reached'); expect(r.meta.provider).toBe('kilo');
});
it('serializes Requesty across chain instances and spaces starts by twelve seconds', async () => {
  vi.useFakeTimers(); const now = () => Date.now(); const starts: number[] = []; let active = 0, maxActive = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { starts.push(now()); active++; maxActive = Math.max(active,maxActive); await new Promise((r) => setTimeout(r,15000)); active--; return ok(); });
  const store = memoryAiStore(now); const a = createAiChain({ fetch,store,now,env }), b = createAiChain({ fetch,store,now,env });
  // Keep each Requesty response below its timeout while holding it long enough to observe the queue.
  fetch.mockImplementation(async () => { starts.push(now()); active++; maxActive = Math.max(active,maxActive); await new Promise((r) => setTimeout(r,5000)); active--; return ok(); });
  const results = Promise.all([a.chat(input), b.chat(input), a.chat(input)]);
  await vi.advanceTimersByTimeAsync(30000); await results;
  expect(maxActive).toBe(1); expect(starts).toHaveLength(3); expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(12000); expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(12000);
});
it('spaces OVH per model, allowing a different OVH model immediately', async () => {
  const s = setup([ok(),ok(),ok()],{},new Set(['requesty','kilo','openrouter']));
  const first = await s.chain.chat(input); const t = s.now(); await s.chain.chat(input); expect(s.now() - t).toBe(30000); expect(first.meta.provider).toBe('ovh');
  const other = setup([new Response('error',{ status:500 }),ok()],{},new Set(['requesty','kilo','openrouter']));
  const start = other.now(); expect((await other.chain.chat(input)).meta.model).toBe('Qwen3.5-397B-A17B'); expect(other.now()).toBe(start);
});
it('keeps keys out of attempts, database records, errors and exhaustion', async () => {
  const secrets = Object.values(env).filter((v) => v?.startsWith('sk-')) as string[];
  const s = setup(Array.from({ length:10 }, () => new Response(secrets.join(' '),{ status:500 })));
  const error = await s.chain.chat(input).catch((e) => e);
  const output = JSON.stringify({ attempts:error.attempts, records:s.store.records, message:error.message, stack:error.stack, usage:await s.store.usageToday() });
  for (const key of secrets) expect(output).not.toContain(key);
  expect(redactProviderText('x'.repeat(195) + env.REQUESTY_API_KEY,env)).not.toContain(env.REQUESTY_API_KEY); expect(redactProviderText('x'.repeat(300),env)).toHaveLength(200);
});
it('shares model cooldowns with other chain instances using the same process clock', async () => {
  const s = setup([new Response('daily used',{ status:429 })]);
  await s.chain.chat(input);
  const other = createAiChain({ fetch:s.fetch,store:s.store,now:s.now,env });
  expect((await other.chat(input)).meta.attempts[0]!.reason).toBe('cooling');
});
it('expires the total budget while waiting for provider spacing without a network attempt', async () => {
  vi.useFakeTimers(); const now = () => Date.now(); const store = memoryAiStore(now);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => ok());
  const chain = createAiChain({ fetch,store,env,now });
  await chain.chat(input);
  const result = chain.chat({ ...input,deadlineMs:100 }).catch((error) => error);
  await vi.advanceTimersByTimeAsync(101);
  expect(await result).toMatchObject({ attempts:[{ reason:'deadline',outcome:'skipped' }] }); expect(fetch).toHaveBeenCalledOnce();
  expect((await store.usageToday())[0]!.calls).toBe(1);
});
