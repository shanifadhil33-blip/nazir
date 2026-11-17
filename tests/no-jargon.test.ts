import { expect, it } from 'vitest';
import { visibleCopy, visibleStrings } from './helpers/source';
import en from '../messages/en.json';

// These are product labels. Transport payloads and the explicit legacy preview
// retain their technical vocabulary without making it public shell copy.
export const shellJargon = /\b(record|recheck|suite|judge|inconclusive|pack|findings|tries|runs?|fixer|supplier|reviewer|owner|viewer)\b/i;
it('keeps shell labels free of internal words and role names', () => {
  for (const group of ['shell', 'checksScreen', 'fixesScreen', 'afterScreen', 'historyScreen', 'reportScreen', 'settingsScreen', 'signin', 'demo'] as const) {
    for (const [key, value] of Object.entries(en[group])) expect(value.replace(/\{\w+\}/g, ''), `${group}.${key}`).not.toMatch(shellJargon);
  }
});

export const bannedWords = [
  'dispatch', 'synergy', 'leverage', 'orchestrate', 'orchestration', 'seamless',
  'cutting edge', 'revolutionary', 'game changer', 'robust', 'empower', 'unlock',
  'copilot', 'AI employee', 'LLM', 'guardrails', 'deterministic', 'certified',
  'compliant', 'guaranteed', 'fully safe', 'government endorsed',
];

export function hasJargon(value: string): boolean {
  return bannedWords.some((word) => new RegExp(String.raw`\b${word.split(' ').join(String.raw`\s+`)}\b`, 'i').test(value));
}

it.each(bannedWords)('Rejects %s regardless of case', (word) => {
  expect(hasJargon(`Your ${word.toUpperCase()} is ready`)).toBe(true);
});
it.each(['Every test has a result.', 'Dispatching', 'unlocked', 'robustness', 'LLMs'])('Allows %s', (value) => {
  expect(hasJargon(value)).toBe(false);
});
it('Skips imports, code identifiers and object keys', () => {
  expect(visibleStrings('import dispatch from "./dispatch"; const synergy = 1; const data = { "robust": 1 };')).toEqual([]);
});
it('Keeps app and message copy plain', () => {
  expect(visibleCopy().filter(({ value }) => hasJargon(value))).toEqual([]);
});
