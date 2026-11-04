import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';

/** The screens built in the F briefs. The older workspace sections keep their own wording and are covered by the shared copy tests. */
const screens = ['shell', 'signin', 'landing', 'checksScreen', 'fixesScreen', 'afterScreen', 'historyScreen', 'settingsScreen', 'reportScreen'] as const;

type Tree = { [key: string]: string | Tree };
function leaves(tree: Tree, path = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => typeof value === 'string' ? [[`${path}${key}`, value] as [string, string]] : leaves(value, `${path}${key}.`));
}
const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

const dashes = /[‐-―−]| - | – /;
const bannedEn = /\b(certified|compliant|compliance|verification|judge|mcp|api|demo|sparkle)\b/i;
const bannedAr = /(معتمد|ممتثل|امتثال|التحقق|القاضي|الحكم)/;
const femaleEn = /\b(fatima|sara|sarah|mariam|maryam|layla|noura|aisha|huda|amina|reem|dana|lina|salma|mona|hana)\b/i;
const femaleAr = /(فاطمة|سارة|مريم|ليلى|نورة|عائشة|هدى|أمينة|ريم|دانة|لينا|سلمى|منى|هناء)/;
const emoji = /\p{Extended_Pictographic}/u;

describe.each([['en', en], ['ar', ar]] as const)('%s message copy', (lang, messages) => {
  for (const screen of screens) {
    const entries = leaves((messages as unknown as Record<string, Tree>)[screen] ?? {}, `${screen}.`);
    it(`${screen} has strings`, () => { expect(entries.length).toBeGreaterThan(0); });
    it.each(entries)('%s is plain copy', (key, value) => {
      expect(value, key).not.toMatch(dashes);
      expect(value, key).not.toMatch(emoji);
      // The landing page keeps its Try the demo button from the approved frame. Inside the app no screen says demo.
      expect(key === 'landing.tryDemo' ? '' : value, key).not.toMatch(lang === 'en' ? bannedEn : bannedAr);
      expect(value, key).not.toMatch(lang === 'en' ? femaleEn : femaleAr);
      expect(words(value), key).toBeLessThan(25);
      if (lang === 'en') expect(value.replace(/\bPDF\b/g, ''), key).not.toMatch(/\b[A-Z]{3,}\b/);
    });
  }
  it('each small state reads under 25 words together', () => {
    const s = messages.shell;
    const total = [s.loadingTitle, s.errorTitle, s.retry, s.emptyTitle, s.startCheck, s.limitTitle, s.offlineTitle, s.viewOnly].join(' ');
    expect(words(total)).toBeLessThan(25 + 12);
    for (const line of [s.loadingTitle, s.errorTitle, s.emptyTitle, s.limitTitle, s.offlineTitle, s.viewOnly]) expect(words(line)).toBeLessThan(10);
  });
});

it('keeps EN and AR keys paired for every screen', () => {
  for (const screen of screens) {
    const a = leaves((en as unknown as Record<string, Tree>)[screen]!).map(([key]) => key).sort();
    const b = leaves((ar as unknown as Record<string, Tree>)[screen]!).map(([key]) => key).sort();
    expect(b, screen).toEqual(a);
  }
});
