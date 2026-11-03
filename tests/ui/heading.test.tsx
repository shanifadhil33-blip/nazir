import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Heading } from '../../src/components/heading';

it('renders a light line and then a bold line', () => {
  const html = renderToStaticMarkup(<Heading light="Your assistant" bold="is doing well" />);
  expect(html).toContain('class="nz-heading"');
  expect(html).toContain('class="nz-heading-light"');
  expect(html).toContain('class="nz-heading-bold"');
  expect(html.indexOf('Your assistant')).toBeLessThan(html.indexOf('is doing well'));
  expect(html.startsWith('<h1')).toBe(true);
  expect(html).toContain('>Your assistant<');
  expect(html).toContain('>is doing well<');
});

it('renders Arabic right to left and English left to right', () => {
  const arabic = renderToStaticMarkup(<Heading lang="ar" light="مساعدك" bold="يعمل جيدا" />);
  expect(arabic).toContain('lang="ar"');
  expect(arabic).toContain('dir="rtl"');
  expect(arabic.indexOf('مساعدك')).toBeLessThan(arabic.indexOf('يعمل جيدا'));
  const english = renderToStaticMarkup(<Heading lang="en" as="h2" light="Ask questions" bold="See mistakes" />);
  expect(english.startsWith('<h2')).toBe(true);
  expect(english).toContain('lang="en"');
  expect(english).toContain('dir="ltr"');
});

it('keeps heading copy free of dashes and extra words', () => {
  const source = readFileSync('src/components/heading.tsx', 'utf8');
  const html = renderToStaticMarkup(<Heading light="Fix safely" bold="Review fixes" />);
  const text = html.replace(/<[^>]+>/g, '');
  expect(text).toBe('Fix safelyReview fixes');
  expect(text).not.toMatch(/[\u2010\u2011\u2012\u2013\u2014-]/);
  expect(text).not.toMatch(/demo|api|judge|certified/i);
  expect(source).not.toMatch(/[\u2013\u2014]/);
});

it('styles the heading pair at 300 and 700 on the v2 type ramp', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  expect(css).toMatch(/\.nz-heading-light \{ font-weight: 300; \}/);
  expect(css).toMatch(/\.nz-heading-bold \{ font-weight: 700; \}/);
  expect(css).toMatch(/\.nz-heading:lang\(ar\) \{ font-family: var\(--font-arabic\), "IBM Plex Sans Arabic", sans-serif; \}/);
});
