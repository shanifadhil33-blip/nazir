import { expect, it, vi } from 'vitest';
import { createAiChain } from '../../src/server/ai/chain';
import { memoryAiStore } from '../../src/server/ai/store';
import { judgeReply, parseJudgeAnswer } from '../../src/server/judge/judge';

const key = 'sk-fictional-long-key';
// A long Government style reply: many sentences, with quotes and a line break, well past 400 characters.
const reply = Array.from({ length: 30 }, (_, i) => `Step ${i + 1}: submit the "form" at the service desk. قدم الطلب في المكتب.`).join('\n');
const prompt = 'Rubric. ' + 'Policy text. '.repeat(1500) + JSON.stringify(reply);
const answer = (span: string, verdict = 'supported', issue = 'none') => JSON.stringify({ verdict, issue, evidence_span: span, reason: 'Matches the record. يطابق السجل.' });
const ok = (content: string, finish_reason?: string) => Response.json({ choices: [{ finish_reason, message: { content } }] });
// Injected clock and sleep so provider spacing never waits in real time.
const run = (fetch: typeof globalThis.fetch, extra: Record<string, string> = {}) => {
  let clock = 0;
  const now = () => clock;
  const chain = createAiChain({ store: memoryAiStore(now), now, sleep: async (ms) => { clock += ms; }, env: { GEMINI_API_KEY: key, ...extra }, fetch });
  return judgeReply({ chain, input: { prompt, reply }, agentFamilies: ['nvidia_nemotron'], seed: 'long' });
};

it('accepts a verbatim quote longer than 400 characters by keeping its first 400', () => {
  const quote = reply.slice(0, 900);
  const parsed = parseJudgeAnswer(answer(quote), reply);
  expect(parsed.evidence_span.length).toBeLessThanOrEqual(400);
  expect(reply.replace(/\s+/g, ' ')).toContain(parsed.evidence_span.replace(/\s+/g, ' '));
});
it('still rejects a long span that is not in the reply', () => {
  expect(() => parseJudgeAnswer(answer('invented '.repeat(100)), reply)).toThrow();
});
it('returns a real verdict when the judge quotes a long span of a long reply', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => ok(answer(reply.slice(0, 900))));
  const result = await run(fetch);
  expect(result.status).toBe('supported');
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).max_tokens).toBeGreaterThanOrEqual(1500);
});
it('fails over from an output cut off by the token limit to a complete verdict', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(ok(answer(reply.slice(0, 200)).slice(0, 90), 'length'))
    .mockResolvedValue(ok(answer(reply.slice(0, 200), 'contradicted', 'false_claim')));
  const result = await run(fetch, { REQUESTY_API_KEY: key });
  expect(result.status).toBe('contradicted');
});
it('never passes when every judge output is cut off: unavailable, retryable', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => ok(answer(reply.slice(0, 200)).slice(0, 90), 'length'));
  const result = await run(fetch);
  expect(result.status).toBe('unavailable');
  expect(result.reason).toBe('judge_unavailable');
  expect(result.labels.ar).toMatch(/[؀-ۿ]/);
});
