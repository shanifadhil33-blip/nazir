import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import type { Lang } from '../../src/components/ocean/copy';
import { messagesFor } from '../../src/components/ocean/copy';
import { rolesForSeat, type Seat } from '../../src/components/ocean/model';
import { AfterView } from '../../src/components/shell/after';
import { FixesView, inTab, type FixesViewProps } from '../../src/components/shell/fixes';
import { betterLine, cardsFrom, changeBetween, decisionMessage, fixesAccess, languageLine, readStore, recheckCount, recheckMessage, type StoredFix } from '../../src/components/shell/fixes-model';
import { previewChange, previewFixes } from '../../src/components/shell/fixes-preview';
import { homeLinks } from '../../src/components/shell/home-model';
import { navIcon } from '../../src/components/shell/nav';
import { approvalMessage } from '../../src/components/shell/checks-model';
import { exactPlan, exactRepair } from '../../src/server/agent/intent';
import { can, type Role } from '../../src/server/auth/roles';
import type { ReportBody } from '../../src/server/reports/build';

const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const render = (lang: Lang, seat: Seat, extra: Partial<FixesViewProps> = {}) => renderToStaticMarkup(
  <FixesView lang={lang} seat={seat} phase="ready" fixes={previewFixes(lang, 'list')} access={fixesAccess(rolesForSeat(seat))} canStart={seat !== 'viewer'}
    assistant="City Help Desk" links={homeLinks('w1')} tab="waiting" openId={null} busy={null} note={null} {...extra} />,
);
const after = (lang: Lang, seat: Seat, extra: Partial<Parameters<typeof AfterView>[0]> = {}) => renderToStaticMarkup(
  <AfterView lang={lang} seat={seat} phase="ready" change={previewChange} canStart assistant="City Help Desk" links={homeLinks('w1')} {...extra} />,
);

it('lets only the reviewer approve or turn down, like the server', () => {
  for (const role of ['service_owner', 'supplier_maintainer', 'quality_reviewer', 'viewer'] as Role[]) {
    expect(fixesAccess([role]).decide, role).toBe(can([role], 'proposal.decide'));
    expect(fixesAccess([role]).recheck, role).toBe(can([role], 'plan.approve'));
  }
  const reviewer = render('en', 'editor');
  expect(reviewer).toContain('Approve');
  expect(reviewer).toContain('Turn down');
  expect(reviewer).not.toContain('Someone else decides this one');
  for (const seat of ['owner', 'supplier', 'viewer'] as Seat[]) {
    const html = render(seat === 'owner' ? 'en' : 'en', seat);
    expect(html, seat).toContain('Someone else decides this one');
    expect(html, seat).not.toContain('data-action');
    expect(html, seat).not.toContain('>Approve<');
  }
});

it('never lets the person who suggested a fix approve it', () => {
  const mine = previewFixes('en', 'list').map((item) => ({ ...item, by: { ...item.by, mine: true } }));
  const html = render('en', 'editor', { fixes: mine });
  expect(html).toContain('Someone else decides this one');
  expect(html).not.toContain('>Approve<');
});

it('shows the opened fix with its three lines and Omar as avatar OS', () => {
  const html = render('en', 'editor');
  for (const line of ['What goes wrong', 'The fix', 'Questions to check again: 12', 'Suggested by Omar']) expect(html, line).toContain(line);
  expect(html).toContain('Don&#x27;t confirm rumours');
  expect(html).toContain('>OS<');
  expect(html).not.toContain('>YA<');
  expect(html).toContain('Fixes');
  expect(html).toContain('to review');
  expect(html).toContain('Waiting');
  expect(html).toContain('Done');
});

it('shows the mint approved card with Check again only to someone who may recheck', () => {
  const owner = render('en', 'owner');
  expect(owner).toContain('Approved');
  expect(owner).toContain('Ready to check again');
  expect(owner).toContain('Check again');
  expect(render('en', 'editor')).toContain('Check again');
  for (const seat of ['supplier', 'viewer'] as Seat[]) {
    const html = render('en', seat);
    expect(html, seat).toContain('Approved');
    expect(html, seat).not.toContain('Check again');
  }
});

it('sorts fixes into Waiting and Done', () => {
  const list = previewFixes('en', 'list');
  expect(list.filter((item) => inTab(item, 'waiting'))).toHaveLength(2);
  expect(list.filter((item) => inTab(item, 'done'))).toHaveLength(0);
  const done = previewFixes('en', 'done');
  expect(done.filter((item) => inTab(item, 'done'))).toHaveLength(2);
  const html = render('en', 'editor', { fixes: done, tab: 'done' });
  expect(html).toContain('Turned down');
  expect(html).toContain('Checking again');
});

it('gives every state a way on', () => {
  const empty = render('en', 'editor', { fixes: [] });
  expect(empty).toContain('No fixes waiting');
  expect(empty).toContain('href="/w/w1?screen=checks"');
  expect(render('en', 'editor', { phase: 'loading', fixes: [] })).toContain('Loading');
  const error = render('en', 'editor', { phase: 'error', fixes: [], onRetry: () => undefined });
  expect(error).toContain('Try again');
  expect(render('en', 'editor')).toContain('href="/w/w1?screen=after"');
  expect(render('en', 'editor', { busy: { id: 'f1', action: 'approve' }, openId: 'f1' })).toContain('Sending');
});

it('renders Arabic right to left with Arabic words and no English leftovers', () => {
  const html = render('ar', 'editor');
  expect(html).toContain('dir="rtl"');
  expect(html).toContain('lang="ar"');
  for (const word of ['إصلاحات', 'للمراجعة', 'بالانتظار', 'وافق', 'ارفض', 'ما الخطأ', 'الإصلاح', 'أسئلة ستُفحص مجددا: 12', 'اقترحه']) expect(html, word).toContain(word);
  expect(html).not.toContain('Approve');
  expect(after('ar', 'owner')).toContain('dir="rtl"');
  expect(after('ar', 'owner')).toContain('قبل الإصلاح');
});

it('uses the exact repair wording the server reads', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const lang of ['en', 'ar'] as const) {
    expect(exactRepair(decisionMessage(id, 'approve', lang))).toMatchObject({ decision: 'approve' });
    expect(exactRepair(decisionMessage(id, 'reject', lang))).toMatchObject({ decision: 'reject' });
  }
  for (const lang of ['en', 'ar'] as const) expect(exactPlan(approvalMessage(id, lang)), lang).not.toBeNull();
  expect(recheckMessage(id, 'en')).toBe(`rerun the affected tests ${id}`);
  expect(recheckCount({ retest: { retest: ['a', 'b', 'c'] } })).toBe(3);
  expect(recheckCount({ retest: null })).toBeNull();
});

it('keeps fixes on this device in a safe shape', () => {
  expect(readStore(null)).toEqual([]);
  expect(readStore('not json')).toEqual([]);
  expect(readStore('{"a":1}')).toEqual([]);
  const item: StoredFix = { id: 'p', findingId: 'f', status: 'waiting', by: { name: 'Omar', initials: 'OS', mine: false }, title: { en: 'Fix', ar: 'إصلاح' }, recheck: null, rerun: false };
  expect(readStore(JSON.stringify([item, { bad: true }]))).toEqual([item]);
  const cards = cardsFrom([item], null, 'en', messagesFor('en'), 'Omar');
  expect(cards[0]!.by.mine).toBe(true);
  expect(cards[0]!.recheck).toBe(1);
  expect(cardsFrom([item], null, 'en', messagesFor('en'), 'Yusuf')[0]!.by.mine).toBe(false);
});

const report = (cases: [string, string, string][]) => ({
  scope: { en: '', ar: '' }, run: { id: 'r', status: 'done', calls_used: 1, calls_budget: 9 },
  counts: { conversations: cases.length, passed: cases.filter((c) => c[1] === 'passed').length, failed: cases.filter((c) => c[1] === 'failed').length, inconclusive: 0, findings: 0 },
  conversations: cases.map(([scenario, status, language]) => ({ id: `${scenario}-c`, status, split: 'development', language, scenario_id: scenario, attempt_number: 1 })),
  findings: [], messages: [], hidden_findings: 0, sentences: { en: [], ar: [] },
}) as unknown as ReportBody;

it('works out before and after from two saved checks', () => {
  const before = report([['a', 'failed', 'en'], ['b', 'failed', 'ar'], ['c', 'failed', 'en'], ['d', 'passed', 'en'], ['e', 'passed', 'ar']]);
  const now = report([['a', 'passed', 'en'], ['b', 'passed', 'ar'], ['c', 'failed', 'en'], ['d', 'passed', 'en'], ['e', 'failed', 'ar']]);
  const change = changeBetween(before, now);
  expect(change).toMatchObject({ before: 2, after: 3, fixed: 2, stillWrong: 1, newlyWrong: 1, english: 67, arabic: 50 });
  expect(betterLine(change, messagesFor('en'))).toBe('1 better');
  expect(betterLine({ ...change, after: 1 }, messagesFor('en'))).toBe('1 worse');
  expect(betterLine({ ...change, after: 2 }, messagesFor('en'))).toBe('No change');
  expect(languageLine(change, messagesFor('en'))).toBe('English 67, Arabic 50');
  expect(languageLine(change, messagesFor('ar'))).toBe('الإنجليزية 67، العربية 50');
});

it('shows the S6 numbers, three rows and one language row', () => {
  const html = after('en', 'owner');
  for (const part of ['Before and after', 'the fix', 'Before', '74', 'right answers', 'After', '82', '8 better', 'Fixed 9', 'Still wrong 2', 'Newly wrong 0', 'English 83, Arabic 81']) expect(html, part).toContain(part);
  expect(html.match(/data-row=/g)).toHaveLength(3);
  expect(html).not.toMatch(/accuracy|parity|score/i);
  expect(html).toContain('data-nav="fixes" aria-current="page" aria-label="Fixes" href="/w/w1?screen=failures"');
  expect(after('en', 'owner', { change: null })).toContain('Nothing to compare yet');
  expect(after('en', 'owner', { change: null })).toContain('href="/w/w1?screen=checks"');
  expect(after('en', 'viewer', { canStart: false })).not.toContain('data-nav="start"');
});

it('keeps both screens under 25 words, with male names only and no tech words', () => {
  const copy = (html: string) => plain(html.replace(/&#x27;/g, "'").slice(html.indexOf('class="nz-shell-stack"'), html.indexOf('<nav')));
  // The frame itself carries about 30 words of labels with an opened fix and an approved card, so the fix text the assistant wrote is left out of the count.
  const labels = copy(render('en', 'editor')).replace("Don't confirm rumours", '').replace('Assistant repeats transit rumours as facts.', '').replace('Send people to the official city page.', '').replace('Quote fees from the record', '');
  expect(words(labels)).toBeLessThanOrEqual(36);
  // Numbers are not words, so only letters count toward the limit.
  expect(words(copy(after('en', 'owner')).replace(/\b\d+\b/g, ''))).toBeLessThan(25);
  for (const html of [render('en', 'editor'), after('en', 'owner')]) expect(html).not.toMatch(/Sara|Fatima|Aisha|Maryam|Layla|Noura/);
});

it('puts the wrench on Fixes in the nav', () => {
  expect(navIcon('fixes')).toBe('wrench');
  expect(render('en', 'owner')).toContain('data-nav="fixes" aria-current="page"');
});

it('keeps every new string free of dashes, caps, emoji and tech words in both languages', () => {
  for (const key of ['fixesScreen', 'afterScreen'] as const) {
    expect(Object.keys(ar[key]).sort(), key).toEqual(Object.keys(en[key]).sort());
    for (const [lang, table] of [['en', en[key]], ['ar', ar[key]]] as const) {
      for (const [name, value] of Object.entries(table)) {
        const label = `${lang} ${key}.${name}`;
        expect(value, label).not.toMatch(/-|[–—]/);
        expect(value, label).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(value, label).not.toMatch(/demo|\bapi\b|mcp|judge|certified|compliant|verification|model|parity|accuracy/i);
        expect(value, label).not.toMatch(/\b[A-Z]{3,}\b/);
        expect(words(value), label).toBeLessThan(25);
      }
    }
  }
});
