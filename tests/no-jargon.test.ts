import { expect, it } from 'vitest';
import { visibleCopy, visibleStrings } from './helpers/source';

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
