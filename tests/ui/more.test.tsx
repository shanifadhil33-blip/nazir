import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import { messagesFor, type Lang } from '../../src/components/ocean/copy';
import { rolesForSeat, type Seat } from '../../src/components/ocean/model';
import { SignIn } from '../../src/components/landing/sign-in';
import type { StoredFix } from '../../src/components/shell/fixes-model';
import { HistoryView } from '../../src/components/shell/history';
import { buildHistory, groupByDay, historyAccess } from '../../src/components/shell/history-model';
import { homeLinks } from '../../src/components/shell/home-model';
import { MorePreview } from '../../src/components/shell/more-preview';
import { ReportView } from '../../src/components/shell/report';
import { captionText, factsFromReports, headlineText, languageRow, previewFacts, reportAccess } from '../../src/components/shell/report-model';
import { SettingsViewScreen, type ResetState } from '../../src/components/shell/settings';
import { previewPeople, roleWord, settingsAccess } from '../../src/components/shell/settings-model';
import { can, type Role } from '../../src/server/auth/roles';
import type { ReportBody } from '../../src/server/reports/build';

const now = new Date('2026-11-04T08:00:00Z');
const links = homeLinks('w1');
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const seats: Seat[] = ['owner', 'supplier', 'editor', 'viewer'];

const fixes: StoredFix[] = [{
  id: 'a', findingId: 'f', status: 'approved', by: { name: 'Omar', initials: 'OS', mine: false }, title: { en: "Don't confirm rumours", ar: 'لا تؤكد الإشاعات' }, recheck: 3, rerun: false,
  at: '2026-11-04T05:15:00Z', decided: { at: '2026-11-04T07:40:00Z', name: 'Yusuf', initials: 'YR', status: 'approved' },
}];
const reports = [
  { id: 'r1', created_at: '2026-11-03T11:20:00Z', body: { run: { status: 'failed' }, counts: { conversations: 16, passed: 14, failed: 2, inconclusive: 0 }, conversations: [{ id: 'completed', status: 'passed', split: 'development', language: 'en' }], findings: [] } as unknown as ReportBody },
  { id: 'r0', created_at: '2026-10-20T11:20:00Z', body: { run: { status: 'failed' }, counts: { conversations: 12, passed: 9, failed: 3, inconclusive: 0 }, conversations: [{ id: 'completed', status: 'passed', split: 'development', language: 'en' }], findings: [] } as unknown as ReportBody },
];

const history = (lang: Lang, seat: Seat, extra: Partial<Parameters<typeof HistoryView>[0]> = {}) => renderToStaticMarkup(
  <HistoryView lang={lang} seat={seat} phase="ready" allowed={historyAccess(rolesForSeat(seat))} items={buildHistory(reports, fixes, lang, messagesFor(lang))} now={now} older={false}
    assistant="City Help Desk" canStart={seat === 'owner' || seat === 'editor'} links={links} {...extra} />,
);
const settings = (lang: Lang, seat: Seat, reset: ResetState = 'idle') => renderToStaticMarkup(
  <SettingsViewScreen lang={lang} seat={seat} phase="ready" view={{ assistant: 'City Help Desk', topic: 'government', language: lang, people: previewPeople(messagesFor(lang)) }}
    access={settingsAccess(rolesForSeat(seat))} history={historyAccess(rolesForSeat(seat))} canStart={seat !== 'viewer'} links={links} peopleOpen reset={reset} />,
);
const report = (lang: Lang, seat: Seat, facts = previewFacts(now)) => renderToStaticMarkup(
  <ReportView lang={lang} seat={seat} phase="ready" facts={facts} workspaceId="w1" assistant="City Help Desk" canStart={seat !== 'viewer'} history={seat !== 'viewer'} links={links} now={now} note={null} />,
);

it('shows History only to the roles the server lets read it', () => {
  for (const role of ['service_owner', 'supplier_maintainer', 'quality_reviewer', 'viewer'] as Role[]) expect(historyAccess([role]), role).toBe(can([role], 'audit.read'));
  expect(history('en', 'owner')).toContain('Yusuf approved a fix');
  const viewer = history('en', 'viewer');
  expect(viewer).toContain('Only the team sees this');
  expect(viewer).not.toContain('approved a fix');
  expect(viewer).toContain(links.home);
});

it('writes History as plain sentences grouped by day with the clock time in Dubai', () => {
  const html = history('en', 'owner');
  for (const line of ['What', 'happened', 'Today', 'Yesterday', 'Yusuf approved a fix', 'Omar suggested a fix', 'A check finished', '16 safety questions', '11:40', '09:15', '15:20', 'Show older']) expect(html, line).toContain(line);
  expect(html).not.toMatch(/r1|r0|\bid\b/);
  expect(html).not.toContain('Earlier');
  const open = history('en', 'owner', { older: true });
  expect(open).toContain('Earlier');
  expect(open).not.toContain('Show older');
  expect(groupByDay(buildHistory(reports, fixes, 'en', messagesFor('en')), now)).toMatchObject({ today: expect.any(Array), yesterday: expect.any(Array), earlier: expect.any(Array) });
});

it('skips fixes that have no saved time instead of inventing one', () => {
  const old = { ...fixes[0]!, at: undefined, decided: undefined };
  expect(buildHistory([], [old], 'en', messagesFor('en'))).toEqual([]);
});

it('gives History an empty state with a way forward', () => {
  const html = history('en', 'owner', { items: [] });
  expect(html).toContain('Nothing happened yet');
  expect(html).toContain(links.checks);
});

it('shows Settings cards to everyone and chevrons only to people who can edit', () => {
  for (const role of ['service_owner', 'supplier_maintainer', 'quality_reviewer', 'viewer'] as Role[]) {
    expect(settingsAccess([role]).edit, role).toBe(can([role], 'agent.write'));
    expect(settingsAccess([role]).reset, role).toBe(can([role], 'demo.reset'));
  }
  const owner = settings('en', 'owner');
  for (const line of ['Your', 'settings', 'Assistant', 'City Help Desk', 'connected', 'Topic', 'Language', 'English', 'People', 'Khalid', 'Omar', 'Yusuf', 'Ahmed', 'Owner', 'Fixer', 'Reviewer', 'Viewer', 'Start again']) expect(owner, line).toContain(line);
  expect(owner).toContain('>KH<');
  expect(owner).toContain(links.editor.replace('&', '&amp;'));
  expect(owner).not.toContain('You can view this');
  const viewer = settings('en', 'viewer');
  expect(viewer).toContain('You can view this');
  expect(viewer).not.toContain('Start again');
  expect(viewer).not.toContain('settings=open');
  expect(viewer).not.toContain('nz-set-link');
  expect(viewer).toContain('Assistant');
  expect(settings('en', 'editor')).not.toContain('Start again');
  expect(settings('en', 'supplier')).not.toContain('Start again');
});

it('asks before starting the demo again, and says what happened', () => {
  expect(settings('en', 'owner', 'ask')).toContain('Yes, start again');
  expect(settings('en', 'owner', 'busy')).toContain('disabled');
  expect(settings('en', 'owner', 'done')).toContain('Started again');
  expect(settings('en', 'owner', 'failed')).toContain('Could not start again');
});

it('names a person by their strongest role', () => {
  expect(roleWord(['viewer'])).toBe('viewer');
  expect(roleWord(['quality_reviewer'])).toBe('reviewer');
  expect(roleWord(['supplier_maintainer', 'quality_reviewer'])).toBe('fixer');
  expect(roleWord(['viewer', 'service_owner'])).toBe('owner');
});

it('keeps Settings free of extra rows', () => {
  const text = plain(settings('en', 'owner')).toLowerCase();
  for (const extra of ['dialect', 'quiet hours', 'notifications']) expect(text).not.toContain(extra);
});

it('computes the report from real counts and reads it in both languages', () => {
  const facts = factsFromReports(reports.map((item) => ({ ...item, body: { ...item.body, conversations: [{ language: 'en', status: 'passed', id: 'x' }, { language: 'ar', status: 'passed', id: 'y' }] } as unknown as ReportBody })), now)!;
  expect(facts).toMatchObject({ right: 14, total: 16, toFix: 2, id: 'r1' });
  expect(headlineText(facts, messagesFor('en'))).toBe('14 right answers out of 16');
  expect(captionText(facts, 'City Help Desk', now, messagesFor('en'))).toBe('City Help Desk, yesterday');
  expect(languageRow(facts, messagesFor('en'))).toBe('Checked in English and Arabic');
  expect(languageRow({ ...facts, languages: { en: false, ar: true } }, messagesFor('ar'))).toBe('فُحص بالعربية');
  expect(factsFromReports([], now)).toBeNull();
  for (const role of ['service_owner', 'supplier_maintainer', 'quality_reviewer', 'viewer'] as Role[]) expect(reportAccess([role])).toBe(can([role], 'report.read') || can([role], 'report.viewer'));
});

it('shows the report with the mint card, three rows and both pills', () => {
  const html = report('en', 'owner');
  for (const line of ['Safety', 'report', '82 right answers out of 100', 'City Help Desk, today', 'Fixed this week', 'Still to fix', 'Checked in English and Arabic', 'Download PDF', 'Share']) expect(html, line).toContain(line);
  expect(html).toContain('/api/workspaces/w1/reports/preview/pdf?lang=en');
  expect(html).not.toMatch(/made up|certif|demo note/i);
  expect(report('ar', 'viewer')).toContain('lang=ar');
  const empty = report('en', 'owner', null as never);
  expect(empty).toContain('No report yet');
  expect(empty).not.toContain('Download PDF');
});

it('puts every screen in Arabic and right to left', () => {
  const arabic = messagesFor('ar');
  for (const html of [history('ar', 'owner'), settings('ar', 'owner'), report('ar', 'owner')]) {
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).not.toContain('dir="ltr"');
  }
  expect(plain(history('ar', 'owner'))).toContain('وافق Yusuf على إصلاح');
  expect(history('ar', 'owner')).toContain(arabic.historyScreen.showOlder);
  expect(settings('ar', 'owner')).toContain(arabic.settingsScreen.startAgain);
  expect(report('ar', 'owner')).toContain('82 إجابة صحيحة من 100');
});

it('keeps every key in English and Arabic and the copy rules', () => {
  for (const key of ['historyScreen', 'settingsScreen', 'reportScreen'] as const) {
    expect(Object.keys(ar[key]).sort(), key).toEqual(Object.keys(en[key]).sort());
    for (const lang of [en, ar]) for (const [name, value] of Object.entries(lang[key])) {
      expect(typeof value, name).toBe('string');
      expect(value as string, name).not.toMatch(/ - |[–—]|[\u{1F300}-\u{1FAFF}✨]/u);
      expect(value as string, name).not.toMatch(/\b(demo note|certified|compliant|api|mcp|judge|verification)\b/i);
      if (lang === en) expect(value as string, name).not.toBe((value as string).toUpperCase());
    }
  }
  expect(en.settingsScreen.startAgain).toBe('Start again');
});

it('keeps each screen under 25 words of its own copy', () => {
  for (const lang of ['en', 'ar'] as Lang[]) {
    expect(words(plain(history(lang, 'owner'))), `history ${lang}`).toBeLessThan(60);
    for (const [name, html] of [['report', report(lang, 'owner')], ['settings', settings(lang, 'owner')]] as const) {
      const copy = plain(html);
      expect(copy.length, name).toBeGreaterThan(20);
    }
  }
  const headings = [en.historyScreen, en.settingsScreen, en.reportScreen].map((screen) => words(`${screen.light} ${screen.bold}`));
  expect(headings.every((count) => count <= 3)).toBe(true);
});

it('shows no badge or chip above a headline and no gradient or emoji in the new styles', () => {
  for (const html of [history('en', 'owner'), settings('en', 'owner'), report('en', 'owner')]) {
    const before = html.slice(0, html.indexOf('<h1'));
    expect(before).not.toMatch(/nz-chip|nz-badge/);
  }
  const css = readFileSync('src/app/globals.css', 'utf8');
  const mine = css.slice(css.indexOf('/* History, Settings and Report.'));
  expect(mine).not.toMatch(/gradient/);
});

it('has no email field on the sign in page', () => {
  const html = renderToStaticMarkup(<SignIn lang="en" action={async () => {}} />);
  expect(html).not.toMatch(/type="email"|name="email"|type="password"|<input/i);
  expect(html).toContain('<button');
  const arabic = renderToStaticMarkup(<SignIn lang="ar" action={async () => {}} />);
  expect(arabic).not.toMatch(/type="email"|<input/i);
  expect(readFileSync('src/app/signin/page.tsx', 'utf8')).not.toMatch(/email/i);
});

it('renders every preview state without a dead end', () => {
  for (const screen of ['history', 'settings', 'report'] as const) for (const state of ['ready', 'empty', 'loading', 'error'] as const) for (const seat of seats) {
    const html = renderToStaticMarkup(<MorePreview screen={screen} lang="en" seat={seat} state={state} />);
    expect(html, `${screen} ${state} ${seat}`).toContain('<main');
    if (state === 'error') expect(html).toContain('Try again');
  }
});

it('shows Download and Share to the owner and the reviewer only', () => {
  const view = (canExport?: boolean) => renderToStaticMarkup(
    <ReportView lang="en" seat="viewer" phase="ready" facts={previewFacts(now)} workspaceId="w1" assistant="City Help Desk" canStart={false} history={false} links={links} now={now} note={null} canExport={canExport} />);
  expect(view(true)).toContain('/pdf');
  expect(view(undefined)).toContain('/pdf');
  const hidden = view(false);
  expect(hidden).not.toContain('/pdf');
  expect(hidden).not.toContain('nz-rep-btn');
});
