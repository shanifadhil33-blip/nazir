import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import { messagesFor } from '../../src/components/ocean/copy';
import { Avatar } from '../../src/components/shell/avatar';
import { Chip } from '../../src/components/shell/chip';
import { ShellHome } from '../../src/components/shell/home';
import { localeAttrs } from '../../src/components/shell/locale';
import { navItems, visualNavOrder, type NavId } from '../../src/components/shell/nav';
import { PastelCard } from '../../src/components/shell/pastel-card';
import { personFor } from '../../src/components/shell/people';
import { PillButton } from '../../src/components/shell/pill-button';
import { PillGrid } from '../../src/components/shell/pill-grid';
import { StateCard } from '../../src/components/shell/state-card';
import { WhiteCard } from '../../src/components/shell/white-card';

const css = readFileSync('src/app/globals.css', 'utf8');
const localeSource = readFileSync('src/components/shell/locale.ts', 'utf8');
const documentLocale = readFileSync('src/components/shell/document-locale.tsx', 'utf8');

function navIds(html: string, className: string): NavId[] {
  const start = html.indexOf(className);
  const slice = html.slice(start, html.indexOf('</nav>', start));
  return [...slice.matchAll(/data-nav="([^"]+)"/g)].map((match) => match[1] as NavId);
}

function words(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

it('AR renders dir=rtl and the nav order mirrors', () => {
  const html = renderToStaticMarkup(<ShellHome lang="ar" seat="owner" />);
  expect(localeAttrs('ar')).toEqual({ lang: 'ar', dir: 'rtl' });
  expect(html).toContain('lang="ar"');
  expect(html).toContain('dir="rtl"');
  expect(html).not.toContain('dir="ltr"');
  const floating = navIds(html, 'nz-float-nav');
  const side = navIds(html, 'nz-side-nav');
  expect(floating).toEqual(['home', 'checks', 'start', 'fixes', 'more']);
  expect(side).toEqual(floating);
  expect(visualNavOrder(floating, 'rtl')).toEqual(['more', 'fixes', 'start', 'checks', 'home']);
  expect(html.indexOf('data-nav="home"')).toBeLessThan(html.indexOf('data-nav="start"'));
  expect(html.indexOf('data-nav="start"')).toBeLessThan(html.indexOf('data-nav="more"'));
});

it('keeps English nav in logical order and sets dir=ltr', () => {
  const html = renderToStaticMarkup(<ShellHome lang="en" seat="owner" />);
  expect(localeAttrs('en')).toEqual({ lang: 'en', dir: 'ltr' });
  expect(html).toContain('dir="ltr"');
  const floating = navIds(html, 'nz-float-nav');
  expect(floating).toEqual(navItems('owner'));
  expect(visualNavOrder(floating, 'ltr')).toEqual(['home', 'checks', 'start', 'fixes', 'more']);
  expect(html).toContain('Your assistant');
  expect(html).toContain('Your assistant is');
  expect(html).toContain('mostly safe');
  expect(html).toContain('City Help Desk');
  expect(html).toContain('>82<');
  expect(html).toContain('>3<');
  expect(html).toContain('Today');
});

it('hides the centre start button for a viewer and keeps it for the other seats', () => {
  const viewer = renderToStaticMarkup(<ShellHome lang="en" seat="viewer" />);
  expect(navIds(viewer, 'nz-float-nav')).toEqual(['home', 'checks', 'fixes', 'more']);
  expect(navIds(viewer, 'nz-side-nav')).toEqual(['home', 'checks', 'fixes', 'more']);
  expect(viewer).not.toContain('data-nav="start"');
  expect(viewer).toContain('Ahmed');
  expect(viewer).toContain('>AK<');
  for (const seat of ['owner', 'editor'] as const) {
    const html = renderToStaticMarkup(<ShellHome lang="en" seat={seat} />);
    expect(navIds(html, 'nz-float-nav')).toContain('start');
    expect(navIds(html, 'nz-side-nav')).toContain('start');
  }
  // The server lets only an owner or a reviewer start a check, so a fixer does not see the button.
  expect(navIds(renderToStaticMarkup(<ShellHome lang="en" seat="supplier" />), 'nz-float-nav')).not.toContain('start');
  expect(renderToStaticMarkup(<ShellHome lang="en" seat="owner" />)).toContain('Khalid Hassan');
  expect(renderToStaticMarkup(<ShellHome lang="en" seat="supplier" />)).toContain('Omar');
  expect(renderToStaticMarkup(<ShellHome lang="en" seat="editor" />)).toContain('Yusuf');
  expect(personFor('owner', messagesFor('en')).initials).toBe('KH');
  expect(personFor('supplier', messagesFor('en')).initials).toBe('OS');
  expect(personFor('editor', messagesFor('en')).initials).toBe('YR');
  expect(personFor('viewer', messagesFor('en')).initials).toBe('AK');
});

it('renders pills, cards, chips, the avatar and the four state cards', () => {
  const ink = renderToStaticMarkup(<PillButton variant="ink" icon="play" label="Start a check" />);
  const quiet = renderToStaticMarkup(<PillButton variant="quiet" tone="mint" icon="eye" label="See mistakes" />);
  expect(ink).toContain('data-variant="ink"');
  expect(ink).toContain('nz-pill-ico');
  expect(quiet).toContain('data-variant="quiet"');
  expect(quiet).toContain('data-tone="mint"');
  const grid = renderToStaticMarkup(<PillGrid><PillButton label="One" /><PillButton label="Two" /></PillGrid>);
  expect(grid).toContain('nz-pill-grid');
  expect(grid.indexOf('One')).toBeLessThan(grid.indexOf('Two'));
  expect(renderToStaticMarkup(<PastelCard tone="sky" title="Last check" value="Today" />)).toContain('data-tone="sky"');
  expect(renderToStaticMarkup(<PastelCard tone="peach" title="To fix" value={3} />)).toContain('nz-pastel-peach');
  expect(renderToStaticMarkup(<WhiteCard kicker="Assistant" title="City Help Desk" live />)).toContain('nz-live-dot');
  expect(renderToStaticMarkup(<Chip kind="right" label="Right" />)).toContain('data-chip="right"');
  expect(renderToStaticMarkup(<Chip kind="wrong" label="Wrong" />)).toContain('data-chip="wrong"');
  expect(renderToStaticMarkup(<Chip kind="unsure" label="Not sure" />)).toContain('>Not sure<');
  expect(renderToStaticMarkup(<Avatar initials="KH" label="Khalid" />)).toContain('aria-label="Khalid"');
  for (const kind of ['loading', 'error', 'empty', 'limit', 'offline', 'view'] as const) {
    const card = renderToStaticMarkup(<StateCard kind={kind} title="Title" body="Body" />);
    expect(card).toContain(`data-state="${kind}"`);
    expect(card).toContain(kind === 'error' ? 'role="alert"' : 'role="status"');
  }
  const empty = renderToStaticMarkup(<ShellHome lang="ar" seat="viewer" state="empty" />);
  expect(empty).toContain('لا يوجد شيء هنا بعد');
  expect(empty).toContain('dir="rtl"');
  expect(empty).not.toContain('data-nav="start"');
});

it('keeps shell copy short, paired, and free of dashes or screen notes', () => {
  expect(Object.keys(en.shell).sort()).toEqual(Object.keys(ar.shell).sort());
  const banned = /demo|\bdev\b|\bapi\b|judge|certified|compliant|verification|\bmcp\b|[\u2728\u2010\u2011\u2012\u2013\u2014-]/i;
  for (const [key, value] of Object.entries(en.shell)) {
    expect(words(value), key).toBeLessThan(25);
    expect(value, key).not.toMatch(banned);
    expect(value, key).not.toMatch(/\b[A-Z]{3,}\b/);
    expect(ar.shell[key as keyof typeof ar.shell].length).toBeGreaterThan(0);
  }
});

it('switches the Arabic font, mirrors directional icons, and parks the side nav from 1024', () => {
  expect(documentLocale).toContain('document.documentElement');
  expect(documentLocale).toContain('root.dir = next.dir');
  expect(readFileSync('src/app/shell/page.tsx', 'utf8')).toContain('document.documentElement.dir');
  expect(localeSource).toContain("lang === 'ar' ? 'rtl' : 'ltr'");
  expect(css).toContain('.nz-shell[dir="rtl"]');
  expect(css).toContain('font-family: var(--font-arabic), "IBM Plex Sans Arabic", sans-serif;');
  expect(css).toContain('[dir="rtl"] .nz-icon-dir { transform: scaleX(-1); }');
  expect(css).toContain('inset-inline-start: 20px;');
  const deskAt = css.indexOf('@media (min-width: 1024px)');
  const desk = css.slice(deskAt, css.indexOf('@media', deskAt + 10));
  expect(desk).toContain('.nz-float-nav { display: none; }');
  expect(desk).toContain('display: flex;');
  expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
  const side = css.slice(css.indexOf('.nz-side-nav {'));
  expect(side).not.toMatch(/\bleft\s*:|\bright\s*:/);
});
