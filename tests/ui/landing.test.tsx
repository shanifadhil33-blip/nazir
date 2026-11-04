import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import { Landing, landingCards, heroSrc } from '../../src/components/landing/landing';
import { SignIn } from '../../src/components/landing/sign-in';
import { SignInButton } from '../../src/components/sign-in-button';

vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), useFormStatus: () => ({ pending: false }) }));

const action = async () => {};
const langs = ['en', 'ar'] as const;

function mainOf(html: string) {
  return html.slice(html.indexOf('<main'), html.indexOf('</main>'));
}
function textOf(html: string) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<img[^>]*>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function words(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

it.each(langs)('S1 %s: heading, two pills, free line, three cards, footer links', (lang) => {
  const html = renderToStaticMarkup(<Landing lang={lang} />);
  const copy = lang === 'ar' ? ar : en;
  for (const text of [copy.landing.lightLine, copy.landing.boldLine, copy.landing.tryDemo, copy.landing.howItWorks, copy.landing.free, copy.signIn, copy.privacy, copy.terms]) expect(html).toContain(text);
  expect(landingCards(lang)).toHaveLength(3);
  for (const card of landingCards(lang)) expect(words(card.label)).toBeLessThanOrEqual(2);
  expect(html).toContain('href="/privacy"');
  expect(html).toContain('href="/terms"');
  expect(html).toContain('href="#how"');
  expect(html).toContain('id="how"');
});

it.each(langs)('S1 %s: main copy stays under 25 words with no dashes, caps, emoji or tech words', (lang) => {
  const html = renderToStaticMarkup(<Landing lang={lang} />);
  const text = textOf(mainOf(html));
  expect(words(text)).toBeLessThan(25);
  expect(text).not.toMatch(/[-–—]/);
  expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(text).not.toMatch(/\b[A-Z]{3,}\b/);
  expect(text).not.toMatch(/demo with|made up|\bAPI\b|\bMCP\b|\bjudge\b|certified|compliant|verification/i);
  expect(html).not.toContain('gradient');
});

it('S1 sits above the headline with nothing: no badge or chip before the heading', () => {
  const html = renderToStaticMarkup(<Landing lang="en" />);
  const main = mainOf(html);
  expect(main.indexOf('<h1')).toBeLessThan(main.indexOf('nz-hero-actions'));
  expect(main.slice(0, main.indexOf('<h1'))).not.toMatch(/nz-mark|chip|badge/);
});

it.each(langs)('S1 %s: uses the real home screen capture on demo data', (lang) => {
  const html = renderToStaticMarkup(<Landing lang={lang} />);
  const src = heroSrc(lang);
  expect(html).toContain(`src="${src}"`);
  const file = `public${src}`;
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file).subarray(1, 4).toString('latin1')).toBe('PNG');
  const alt = (lang === 'ar' ? ar : en).landing.heroAlt;
  expect(html).toContain(alt);
  if (lang === 'en') {
    expect(alt).toContain('Khalid');
    expect(alt).toContain('City Help Desk');
  }
});

it('uses male names only in the landing and sign in copy', () => {
  const female = /\b(sara|sarah|fatima|aisha|maryam|layla|noor|mariam|huda|amina|zainab|khadija)\b/i;
  const all = JSON.stringify([en.landing, en.signin, ar.landing, ar.signin]);
  expect(all).not.toMatch(female);
});

it('AR renders fully right to left and mirrors the language switch target', () => {
  const landing = renderToStaticMarkup(<Landing lang="ar" />);
  expect(landing).toContain('lang="ar"');
  expect(landing).toContain('dir="rtl"');
  expect(landing).not.toContain('dir="ltr"');
  expect(landing).toContain('href="/"');
  expect(landing).toContain('English');
  const signin = renderToStaticMarkup(<SignIn lang="ar" action={action} />);
  expect(signin).toContain('dir="rtl"');
  expect(signin).not.toContain('dir="ltr"');
  expect(renderToStaticMarkup(<Landing lang="en" />)).toContain('href="/?lang=ar"');
});

it('EN and AR have the same landing and sign in keys', () => {
  expect(Object.keys(ar.landing).sort()).toEqual(Object.keys(en.landing).sort());
  expect(Object.keys(ar.signin).sort()).toEqual(Object.keys(en.signin).sort());
  for (const value of [...Object.values(ar.landing), ...Object.values(ar.signin)]) expect(value.trim()).not.toBe('');
});

it.each(langs)('S2 %s: one Google card, no email or password field, no second sign in link', (lang) => {
  const html = renderToStaticMarkup(<SignIn lang={lang} action={action} />);
  const copy = lang === 'ar' ? ar : en;
  expect(html).not.toMatch(/<input/i);
  expect(html).not.toMatch(/type="(email|password|text)"/);
  expect(html).not.toMatch(/@|forgot|password|email/i);
  expect(html).toContain(copy.signin.welcome);
  expect(html).toContain(copy.signin.welcomeBold);
  expect(html).toContain(copy.signin.google);
  expect(html).not.toContain(`>${copy.signIn}<`);
  expect(html.match(/class="nz-site-link"/g)).toHaveLength(1);
  expect(html.match(/<form/g)).toHaveLength(1);
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain('href="/privacy"');
  const text = textOf(mainOf(html));
  expect(words(text)).toBeLessThan(25);
  expect(text).not.toMatch(/[-–—]/);
});

it('S2 button carries the pressed state hooks', () => {
  const html = renderToStaticMarkup(<SignInButton />);
  expect(html).toContain('type="submit"');
  expect(html).toContain('data-pending="false"');
  const css = readFileSync('src/app/globals.css', 'utf8');
  expect(css).toMatch(/\.nz-signin:active:not\(:disabled\)/);
  expect(css).toMatch(/\.nz-signin\[data-pending="true"\]/);
});

it('keeps the Auth.js Google flow untouched', () => {
  const route = readFileSync('src/app/signin/page.tsx', 'utf8');
  expect(route).toContain("signIn('google', { redirectTo: '/w' })");
});
