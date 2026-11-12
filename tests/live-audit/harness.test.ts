import { expect, it } from 'vitest';
import { classifyClick, duplicateDestinations } from '../../scripts/live-audit/crawl.mjs';
import { comparePersistence } from '../../scripts/live-audit/persist.mjs';
import { steps } from '../../scripts/gate.mjs';

const before = { url: '/checks', stateHash: 'same' };
it('detects dead controls and cards without actions without launching a browser', () => {
  expect(classifyClick(before, before)).toBe('DEAD-CONTROL');
  expect(classifyClick(before, before, { actionable: false })).toBe('NOT-CLICKABLE');
  expect(classifyClick(before, before, { disabled: true })).toBe('DISABLED');
  expect(classifyClick(before, { ...before, stateHash: 'opened' })).toBe('CHANGED');
  expect(classifyClick(before, { ...before, url: '/checks/one' })).toBe('CHANGED');
  expect(classifyClick(before, before, { externalEffect: true })).toBe('CHANGED');
});
it('detects siblings opening identical content even under different URLs', () => {
  const one = { id: 'one', screen: 'checks', siblingGroup: 'list', verdict: 'CHANGED', destination: { heading: 'Check', textHash: 'same', url: '/one' } };
  expect(duplicateDestinations([one, { ...one, id: 'two', destination: { ...one.destination, url: '/two' } }])).toEqual([
    { verdict: 'SAME-AS-OTHER', first: 'one', second: 'two', screen: 'checks' },
  ]);
  expect(duplicateDestinations([one, { ...one, id: 'two', destination: { ...one.destination, textHash: 'different' } }])).toEqual([]);
  expect(duplicateDestinations([one, { ...one, id: 'two', siblingGroup: 'other' }])).toEqual([]);
});
it('reports missing persistence across reload and a fresh sign in', () => {
  const state = { reports: ['one', 'two'] };
  expect(comparePersistence(state, state, state).matches).toBe(true);
  expect(comparePersistence(state, state, { reports: [] }).matches).toBe(false);
  expect(comparePersistence(state, { reports: [] }, state).matches).toBe(false);
});
it('keeps browser audits out of the gate', () => {
  expect(steps).toEqual(['lint', 'typecheck', 'test', 'build']);
});
