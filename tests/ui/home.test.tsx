import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import { messagesFor } from '../../src/components/ocean/copy';
import { ShellHome } from '../../src/components/shell/home';
import {
  buildHomeView, daysBetween, headingFor, homeAccess, homeLinks, homeVariant, lastCheckText, scoreWord, type HomeFacts,
} from '../../src/components/shell/home-model';
import { initialsOf } from '../../src/components/shell/people';
import { actions, can, type Role } from '../../src/server/auth/roles';

const now = new Date('2026-11-04T08:00:00Z');
const checked: HomeFacts = { checks: 5, score: 82, right: 41, toFix: 7, lastAt: now };
const none: HomeFacts = { checks: 0, score: 0, right: 0, toFix: 0, lastAt: null };
const render = (lang: 'en' | 'ar', roles: string[], facts: HomeFacts, seat: 'owner' | 'editor' | 'supplier' | 'viewer' = 'owner') =>
  renderToStaticMarkup(<ShellHome lang={lang} seat={seat} view={buildHomeView(roles, facts, 'City Help Desk')} now={now} />);

it('hides each pill exactly as the server role matrix allows', () => {
  for (const role of ['service_owner', 'supplier_maintainer', 'quality_reviewer', 'viewer'] as Role[]) {
    const access = homeAccess([role]);
    expect(access.start, role).toBe(can([role], 'plan.propose'));
    expect(access.fixes, role).toBe(can([role], 'finding.read'));
    expect(access.settings, role).toBe(can([role], 'agent.write'));
    expect(access.report, role).toBe(can([role], 'report.read') || can([role], 'report.viewer'));
  }
  expect(actions).toContain('plan.propose');
});

it('shows the four pills and three cards to an owner with real numbers', () => {
  const html = render('en', ['service_owner'], checked);
  for (const label of ['Start a check', 'Fixes', 'Report', 'Settings', 'Right answers', 'To fix', 'Last check', 'Today']) expect(html).toContain(label);
  expect(html).toContain('>41<');
  expect(html).toContain('>7<');
  expect(html).toContain('Your assistant is');
  expect(html).toContain('mostly safe');
  expect(html).not.toContain('You can view this');
});

it('shows a viewer only Report and Fixes with one soft line and no start button', () => {
  const html = render('en', ['viewer'], checked, 'viewer');
  expect(html).toContain('data-variant="viewer"');
  expect(html).toContain('>Report<');
  expect(html).toContain('>Fixes<');
  expect(html).toContain('You can view this');
  expect(html).not.toContain('Start a check');
  expect(html).not.toContain('Settings');
  expect(html).not.toContain('data-nav="start"');
  expect(html).toContain('>AK<');
});

it('shows the first time home with one start pill and no cards', () => {
  const html = render('en', ['service_owner'], none);
  expect(html).toContain('data-variant="first"');
  expect(html).toContain("Let&#x27;s check");
  expect(html).toContain('your assistant');
  expect(html).toContain('Your first check takes about two minutes');
  expect(html).toContain('Start first check');
  expect(html).not.toContain('Right answers');
  expect(html).not.toContain('Last check');
  expect(html.match(/nz-hero-btn/g)).toHaveLength(1);
});

it('never offers a start button to a role that cannot start, even on a first time home', () => {
  expect(homeVariant(homeAccess(['supplier_maintainer']), ['supplier_maintainer'], 0)).toBe('quiet');
  const html = render('en', ['supplier_maintainer'], none, 'supplier');
  expect(html).not.toContain('Start first check');
  expect(html).not.toContain('Start a check');
  expect(html).toContain('has no checks yet');
  expect(html).toContain('>Fixes<');
});

it('words the headline from the real score', () => {
  const copy = messagesFor('en');
  expect(scoreWord(95, copy)).toBe('safe');
  expect(scoreWord(82, copy)).toBe('mostly safe');
  expect(scoreWord(55, copy)).toBe('needs care');
  expect(scoreWord(10, copy)).toBe('not safe yet');
  const view = buildHomeView(['service_owner'], { ...checked, score: 55 }, 'x');
  expect(headingFor(view, copy)).toEqual({ light: 'Your assistant is', bold: 'needs care' });
  expect(headingFor(buildHomeView(['service_owner'], none, 'x'), copy).bold).toBe('your assistant');
});

it('words the last check by calendar day', () => {
  const copy = messagesFor('en');
  expect(daysBetween(new Date('2026-11-04T01:00:00Z'), now)).toBe(0);
  expect(lastCheckText(null, now, copy)).toBe('None yet');
  expect(lastCheckText(new Date('2026-11-04T01:00:00Z'), now, copy)).toBe('Today');
  expect(lastCheckText(new Date('2026-11-03T05:00:00Z'), now, copy)).toBe('Yesterday');
  expect(lastCheckText(new Date('2026-11-01T05:00:00Z'), now, copy)).toBe('3 days ago');
  expect(lastCheckText(new Date('2026-11-01T05:00:00Z'), now, messagesFor('ar'))).toBe('قبل 3 أيام');
});

it('renders Arabic right to left with Arabic words', () => {
  const html = render('ar', ['service_owner'], checked);
  expect(html).toContain('dir="rtl"');
  expect(html).not.toContain('dir="ltr"');
  expect(html).toContain('ابدأ فحصا');
  expect(html).toContain('إجابات صحيحة');
  expect(html).toContain('اليوم');
  expect(html).not.toMatch(/Start a check|Right answers/);
  const first = render('ar', ['service_owner'], none);
  expect(first).toContain('ابدأ أول فحص');
  expect(first).toContain('يستغرق أول فحص');
  expect(render('ar', ['viewer'], checked, 'viewer')).toContain('يمكنك العرض فقط');
});

it('makes every tap go somewhere', () => {
  const links = homeLinks('w1');
  const html = renderToStaticMarkup(<ShellHome lang="en" seat="owner" links={links} view={buildHomeView(['service_owner'], checked, 'x')} now={now} />);
  for (const href of [links.start, links.fixes, links.report, links.settings, links.checks, links.home]) {
    expect(html).toContain(`href="${href.replace('&', '&amp;')}"`);
  }
  expect(html).toContain('aria-expanded="false"');
});

it('keeps the new home copy short, paired, plain and free of dashes', () => {
  expect(Object.keys(en.shell).sort()).toEqual(Object.keys(ar.shell).sort());
  const banned = /demo|\bdev\b|\bapi\b|judge|certified|compliant|verification|\bmcp\b|[‐-―-]/i;
  for (const lang of [en, ar]) {
    for (const [key, value] of Object.entries(lang.shell)) {
      expect(value, key).not.toMatch(banned);
      expect(value.split(/\s+/).length, key).toBeLessThan(25);
      expect(value, key).not.toMatch(/\b[A-Z]{3,}\b/);
      expect(value, key).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  }
  const total = (lang: typeof en) => [lang.shell.letsCheck, lang.shell.yourAssistantBold, lang.shell.firstCheckNote, lang.shell.startFirst].join(' ').split(/\s+/).length;
  expect(total(en)).toBeLessThan(25);
});

it('names a real person with initials and keeps male sample names', () => {
  expect(initialsOf('Khalid Hassan')).toBe('KH');
  expect(initialsOf('omar')).toBe('O');
  expect(initialsOf('خالد حسن')).toBe('خح');
  expect(en.shell.khalid).toBe('Khalid');
  expect(en.shell.ahmed).toBe('Ahmed');
});

it('has no search box, no sparkle and no gradient in the home', () => {
  const source = readFileSync('src/components/shell/home.tsx', 'utf8');
  expect(source).not.toMatch(/<input/);
  expect(source).not.toMatch(/sparkle/i);
  const css = readFileSync('src/app/globals.css', 'utf8');
  const shell = css.slice(css.indexOf('/* Shell:'), css.indexOf('/* Landing and sign in'));
  expect(shell).not.toMatch(/gradient/);
});

it('keeps the sign in page free of an email field', () => {
  for (const file of ['src/app/signin/page.tsx', 'src/components/landing/sign-in.tsx', 'src/components/sign-in-button.tsx']) {
    const source = readFileSync(file, 'utf8');
    expect(source, file).not.toMatch(/type=["']email["']|name=["']email["']|<input/i);
  }
});
