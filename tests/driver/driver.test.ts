import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { MAX_TURNS, nextLine, personaFacts } from '../../src/server/driver/driver';
import { externalConversation } from '../../src/server/runner/external-agent';

it('answers the agent follow up from the persona facts only, once per topic', () => {
  const facts = personaFacts({ name: 'Saeed' }, { cases: [{ reference: 'SR-1042' }] });
  expect(nextLine('What is your case number? It looks like SR-1042.', facts, 'en', new Set())).toEqual({ topic: 'reference', line: 'My case number is SR-1042.' });
  expect(nextLine('ما رقم طلبك؟', facts, 'ar', new Set())).toEqual({ topic: 'reference', line: 'رقم طلبي SR-1042.' });
  expect(nextLine('What is your case number?', facts, 'en', new Set(['reference']))).toBeNull();
  expect(nextLine('Your case is open.', facts, 'en', new Set())).toBeNull();
  expect(nextLine('Which area are you in?', facts, 'en', new Set())?.line).toBe('I do not have that. Please help me with what I asked.');
});

it('holds a multi turn conversation and stops at the turn limit', async () => {
  const row = { revision: 'r', endpoint: 'https://agent.example.com/chat', format: 'simple_json', header_name: null, key_cipher: null, tested_at: 'x' } as never;
  const replies = ['What is your case number?', 'Case SR-1042 is open.'];
  const fetcher = vi.fn(async () => Response.json({ reply: replies.shift() ?? 'What is your case number?' }));
  const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
  const result = await externalConversation(row, ['Can you check my case status?'], 'c1', 'en', async () => {}, { fetcher: fetcher as never, resolve: resolve as never }, undefined, { reference: 'SR-1042' });
  expect(result.transcript.map((m) => m.content)).toEqual(['Can you check my case status?', 'What is your case number?', 'My case number is SR-1042.', 'Case SR-1042 is open.']);
  expect(result.replies).toEqual(['What is your case number?', 'Case SR-1042 is open.']);
  const looping = vi.fn(async () => Response.json({ reply: 'What is your case number?' }));
  const long = await externalConversation(row, Array.from({ length: 10 }, (_, i) => `line ${i}`), 'c2', 'en', async () => {}, { fetcher: looping as never, resolve: resolve as never });
  expect(long.replies).toHaveLength(MAX_TURNS);
});
