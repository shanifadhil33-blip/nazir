import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps settings panel styles from restyling the failure case tabs', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const unscoped = css.split('\n').filter((line) => /^\.nz-seg button/.test(line.trim()));
  expect(unscoped).toEqual([]);
  expect(css).toContain('.nz-seg-btn[aria-selected="true"] { color: #fff; }');
});
