import { expect, it } from 'vitest';
import { paneScroll } from '../../src/components/shell/checks-scroll';

it('keeps the list spot on a phone and puts the opened check at the top', () => {
  expect(paneScroll('list', 'check', true, 640, 0)).toEqual({ top: 0, saved: 640 });
  expect(paneScroll('check', 'list', true, 0, 640)).toEqual({ top: 640, saved: 640 });
});

it('does not move the window on a wide screen or when the pane stays the same', () => {
  expect(paneScroll('list', 'check', false, 640, 0)).toBeNull();
  expect(paneScroll('check', 'check', true, 120, 640)).toBeNull();
  expect(paneScroll('list', 'list', true, 40, 0)).toBeNull();
});
