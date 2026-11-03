import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');
const layout = readFileSync('src/app/layout.tsx', 'utf8');

it('defines the v2 page, ink, accent and pastel tokens', () => {
  expect(css).toContain('--page: #F4F6F8;');
  expect(css).toContain('--card: #FFFFFF;');
  expect(css).toContain('--ink: #16181D;');
  expect(css).toContain('--accent: #16181D;');
  expect(css).toContain('--right: #2E9E7A;');
  expect(css).toContain('--wrong: #E0614F;');
  expect(css).toContain('--mint: #DFF3EC;');
  expect(css).toContain('--sky: #E3EEF9;');
  expect(css).toContain('--peach: #FCE9DF;');
  expect(css).toContain('--radius-card: 24px;');
  expect(css).toContain('--radius-pill: 999px;');
  expect(css).toMatch(/--shadow:\s*0 16px 40px rgba\(22, 24, 29, \.08\);/);
});

it('paints the page and body with the new tokens and drops the sea palette', () => {
  expect(css).toMatch(/html \{ color: var\(--ink\); background: var\(--page\); \}/);
  expect(css).toMatch(/font-size: 16px;/);
  expect(css).toContain('font-family: var(--font-sans), "Plus Jakarta Sans", sans-serif;');
  expect(css).toContain('font-family: var(--font-arabic), "IBM Plex Sans Arabic", sans-serif;');
  expect(css).not.toMatch(/#083F4C|#0D6E79|#68C7C1|#0E7C86|#E37B6C|#9D342C|#0C3A44|Fraunces|\bInter\b/);
  expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  expect(css).not.toMatch(/--sea-|--teal:|--coral:|--rust:|--glass:/);
});

it('gives cards a 24px radius and a shadow, and pills a full radius, without a card border', () => {
  expect(css).toMatch(/\.nz-header, \.nz-panel \{[^}]*border: 0;[^}]*box-shadow: var\(--shadow\);[^}]*border-radius: var\(--radius-card\);/);
  expect(css).toMatch(/\.nz-composer \{[^}]*border: 0;[^}]*border-radius: var\(--radius-pill\);/);
  expect(css).toMatch(/\.nz-card \{[^}]*border: 0;[^}]*border-radius: var\(--radius-card\);[^}]*box-shadow: var\(--shadow\);/);
});

it('self hosts Plus Jakarta Sans and IBM Plex Sans Arabic at 300, 400 and 700', () => {
  expect(layout).toContain("from 'next/font/google'");
  expect(layout).toContain('Plus_Jakarta_Sans');
  expect(layout).toContain('IBM_Plex_Sans_Arabic');
  expect(layout).toContain("weight: ['300', '400', '700']");
  expect(layout).not.toContain('Fraunces');
  expect(layout).not.toContain('Inter');
});
