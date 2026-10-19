import { expect, it } from 'vitest';
import { visibleCopy } from './helpers/source';

function hasOptional(value: string): boolean {
  return /\boptional\b/i.test(value);
}

it.each(['optional', 'An OPTIONAL extra'])('Rejects %s', (value) => {
  expect(hasOptional(value)).toBe(true);
});
it.each(['Choose an extra', 'optionally'])('Allows %s', (value) => {
  expect(hasOptional(value)).toBe(false);
});
it('Keeps the word optional out of visible copy', () => {
  expect(visibleCopy().filter(({ value }) => hasOptional(value))).toEqual([]);
});
