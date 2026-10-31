import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps settings panel styles from restyling the failure case tabs', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const unscoped = css.split('\n').filter((line) => /^\.nz-seg button/.test(line.trim()));
  expect(unscoped).toEqual([]);
  expect(css).toContain('.nz-seg-btn[aria-selected="true"] { color: #fff; }');
});

it('keeps score digits together and lets the compact workspace name wrap in either direction', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const scoreRule = css.match(/^\.nz-score-num \{([^}]+)\}/m)?.[1];
  expect(scoreRule).toMatch(/white-space: nowrap;/);
  expect(scoreRule).toMatch(/flex-shrink: 0;/);
  expect(css).toMatch(/\.nz-compact > span:first-child \{ min-width: 0; overflow-wrap: anywhere; \}/);
  expect(css).toMatch(/\.nz-compact > div \{ flex-shrink: 0; \}/);
  expect(css).toMatch(/\.nz-compact .nz-score-num \{ font-size: 32px; \}/);
  expect(css).toMatch(/\.nz-compact-counts \{[^}]*font-size: 14px;/);
});
