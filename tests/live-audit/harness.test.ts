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

it('waits for delayed same path query navigation even when an earlier pressed state changes', async () => {
  const { waitForClick } = await import('../../scripts/live-audit/crawl.mjs');
  const { snapshot } = await import('../../scripts/live-audit/signin.mjs');
  let turns = 0;
  const state = { url: '/w/one', heading: 'Home', text: 'Home', controls: [], expanded: [] };
  const page = {
    evaluate: async () => ({ ...state }),
    waitForTimeout: async () => { if (++turns === 3) { state.url = '/w/one?screen=checks'; state.heading = 'Checks'; } },
  };
  const before = await snapshot(page);
  state.text = 'Home pressed';
  const after = await waitForClick(page, before, true);
  expect(turns).toBe(3);
  expect(after.url).toBe('/w/one?screen=checks');
  expect(classifyClick(before, after)).toBe('CHANGED');
});
it('omits a side navigation control whose ancestor has display none', async () => {
  const { inventoryElements } = await import('../../scripts/live-audit/crawl.mjs');
  const { vi } = await import('vitest');
  const body = { tagName: 'BODY', parentElement: null, style: { display: 'block', visibility: 'visible' } };
  const hidden = { tagName: 'NAV', parentElement: body, style: { display: 'none', visibility: 'visible' }, children: [] as unknown[] };
  const button = (parentElement: unknown) => ({ tagName: 'BUTTON', parentElement, style: { display: 'block', visibility: 'visible' },
    textContent: 'Open', getClientRects: () => [1], matches: (selector: string) => selector === 'a,button,[role=button],[onclick]',
    querySelector: () => null, closest: () => null, getAttribute: () => null });
  const invisible = button(hidden), visible = button(body);
  hidden.children = [invisible];
  vi.stubGlobal('document', { body }); vi.stubGlobal('getComputedStyle', (element: { style: unknown }) => element.style);
  Object.assign(body, { children: [hidden, visible] });
  try { expect(inventoryElements([invisible, visible])).toHaveLength(1); }
  finally { vi.unstubAllGlobals(); }
});
it('still classifies a control as dead after waiting through its observation window', async () => {
  const { waitForClick } = await import('../../scripts/live-audit/crawl.mjs');
  const { snapshot } = await import('../../scripts/live-audit/signin.mjs');
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  const page = { evaluate: async () => ({ url: '/w/one', heading: 'Checks', text: 'Checks', controls: [], expanded: [] }), waitForTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)) };
  try {
    const before = await snapshot(page);
    const waiting = waitForClick(page, before, true, 300);
    await vi.advanceTimersByTimeAsync(400);
    expect(classifyClick(before, await waiting)).toBe('DEAD-CONTROL');
  } finally { vi.useRealTimers(); }
});
