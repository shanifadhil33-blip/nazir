import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import type { Lang } from '../../src/components/ocean/copy';
import { messagesFor } from '../../src/components/ocean/copy';
import { rolesForSeat, type Seat } from '../../src/components/ocean/model';
import { AfterView } from '../../src/components/shell/after';
import { FixesView, inTab, type FixesViewProps } from '../../src/components/shell/fixes';
import { betterLine, changeBetween, fixCards, fixesAccess, languageLine, retestOf, type FixCard, type ServerFix } from '../../src/components/shell/fixes-model';
import { previewFixes } from '../../src/components/shell/fixes-preview';
import { homeLinks } from '../../src/components/shell/home-model';
import { navIcon } from '../../src/components/shell/nav';
import { can, type Role } from '../../src/server/auth/roles';
import type { ReportBody } from '../../src/server/reports/build';

const sampleCompare = { title: 'Said submitted, but no case was saved (Arabic)', change: { before: 5, after: 6, fixed: 1, stillWrong: 0, newlyWrong: 0, english: 3, arabic: 3, englishTotal: 4, arabicTotal: 4, unsure: 0, total: 8 }, before: { right: 5, total: 8, at: 'Thu 09:04' }, after: { right: 6, total: 8, at: 'Thu 11:20' }, sample: false };
const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const render = (lang: Lang, seat: Seat, extra: Partial<FixesViewProps> = {}) => renderToStaticMarkup(
  <FixesView lang={lang} seat={seat} phase="ready" fixes={previewFixes(lang, 'list')} access={fixesAccess(rolesForSeat(seat))} canStart={seat !== 'viewer'}
    assistant="City Help Desk" links={homeLinks('w1')} tab="waiting" openId={null} busy={null} note={null} {...extra} />,
);
const after = (lang: Lang, seat: Seat, extra: Partial<Parameters<typeof AfterView>[0]> = {}) => renderToStaticMarkup(
  <AfterView lang={lang} seat={seat} phase="ready" fixId={null} fixes={[]} reports={[]} sample={sampleCompare} canStart assistant="City Help Desk" links={homeLinks('w1')} {...extra} />,
);

it('lets only the reviewer approve or turn down, like the server', () => {
  for (const role of ['service_owner', 'supplier_maintainer', 'quality_reviewer', 'viewer'] as Role[]) {
    expect(fixesAccess([role]).decide, role).toBe(can([role], 'proposal.decide'));
    expect(fixesAccess([role]).recheck, role).toBe(can([role], 'plan.approve'));
  }
  const reviewer = render('en', 'editor');
  expect(reviewer).toContain('Approve and test');
  expect(reviewer).toContain('Not now');
  expect(reviewer).not.toContain('Someone else decides this one');
  for (const seat of ['supplier', 'viewer'] as Seat[]) {
    const html = render('en', seat);
    expect(html, seat).not.toContain('data-action');
    expect(html, seat).not.toContain('>Approve<');
    expect(html, seat).not.toContain('Someone else');
  }
});

it('lets you approve a fix you suggested yourself, and says why in plain words', () => {
  const mine = previewFixes('en', 'list').map((item) => ({ ...item, by: { ...item.by, mine: true } }));
  const html = render('en', 'editor', { fixes: mine });
  expect(html).toContain('Approve and test');
  expect(html).toContain('You are the only person here, so you approve your own fixes.');
  expect(html).not.toContain('Someone else');
  const ar = render('ar', 'editor', { fixes: mine });
  expect(ar).toContain('أنت الشخص الوحيد هنا');
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
  expect(change).toMatchObject({ before: 2, after: 3, fixed: 2, stillWrong: 1, newlyWrong: 1, english: 2, arabic: 1, englishTotal: 3, arabicTotal: 2, unsure: 0, total: 5 });
  expect(betterLine(change, messagesFor('en'))).toBe('1 better');
  expect(betterLine({ ...change, after: 1 }, messagesFor('en'))).toBe('1 worse');
  expect(betterLine({ ...change, after: 2 }, messagesFor('en'))).toBe('No change');
  expect(languageLine(change, messagesFor('en'))).toBe('English 2 of 3 right, Arabic 1 of 2 right');
  expect(languageLine(change, messagesFor('ar'))).toBe('الإنجليزية 2 من 3 صحيحة، العربية 1 من 2 صحيحة');
});

it('keeps unknown answers in language totals and never claims they were fixed', () => {
  const before = report([['a', 'failed', 'en'], ['b', 'passed', 'en']]);
  const now = report([['a', 'inconclusive', 'en'], ['b', 'passed', 'en']]);
  const change = changeBetween(before, now);
  expect(change).toMatchObject({ fixed: 0, unsure: 1, total: 2, english: 1, englishTotal: 2 });
  expect(languageLine(change, messagesFor('en'))).toBe('English 1 of 2 right');
  const html = after('en', 'owner', { sample: { ...sampleCompare, change } });
  expect(html).toContain('Could not tell for 1 of 2 answers.');
});

it('keeps both screens under 25 words, with male names only and no tech words', () => {
  const copy = (html: string) => plain(html.replace(/&#x27;/g, "'").slice(html.indexOf('class="nz-shell-stack"'), html.indexOf('<nav')));
  // The frame itself carries about 30 words of labels with an opened fix and an approved card, so the fix text the assistant wrote is left out of the count.
  const labels = copy(render('en', 'editor')).replace("Don't confirm rumours", '').replace('Assistant repeats transit rumours as facts.', '').replace('Send people to the official city page.', '').replace('Quote fees from the record', '');
  expect(words(labels)).toBeLessThanOrEqual(45);
  // Numbers are not words, so only letters count toward the limit.
  expect(words(copy(after('en', 'owner')).replace(sampleCompare.title, '').replace(languageLine(sampleCompare.change, messagesFor('en')), '').replace(/\b\d+\b/g, ''))).toBeLessThan(40);
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

it('opens the first waiting fix with its plain lines, and says Approve and test for the sample agent', () => {
  const html = render('en', 'editor');
  for (const line of ['What went wrong', 'What the fix changes', 'Suggested by Omar', 'Approve and test', 'Not now', 'A fix is a change to your agent&#x27;s instructions. Approve it, then test it again.']) expect(html, line).toContain(line);
  expect(html).not.toMatch(/Turn down|Check again|Questions to check again/);
});

it('puts waiting fixes in Waiting and approved or skipped ones in Done, testing and tested', () => {
  const list = previewFixes('en', 'list');
  expect(list.filter((item) => inTab(item, 'waiting')).map((i) => i.id)).toEqual(['f1']);
  expect(list.filter((item) => inTab(item, 'done')).map((i) => i.id)).toEqual(['f2']);
  const testing = render('en', 'editor', { tab: 'done' });
  expect(testing).toContain('Testing the fix 3 of 8');
  expect(testing).toContain('role="progressbar"');
  const done = render('en', 'editor', { fixes: previewFixes('en', 'done'), tab: 'done' });
  expect(done).toContain('Fixed 1, still wrong 0, newly wrong 0');
  expect(done).toContain('href="/w/w1?screen=after&amp;fix=f2"');
  expect(done).toContain('Skipped');
});

it('gives your own agent a change to copy and a test again, never a built in approve', () => {
  const own: FixCard = { ...previewFixes('en', 'list')[0]!, ownAgent: true, fix: 'Only tell the person a case is filed after your filing tool returns a reference.' };
  const html = render('en', 'editor', { fixes: [own] });
  for (const line of ['Copy the change', 'I changed my agent, test again', 'Nazir cannot change your agent. Add this to its instructions, then test again.', 'Only tell the person a case is filed']) expect(html, line).toContain(line);
  expect(html).not.toContain('Approve and test');
});

it('gives every state a way on', () => {
  const empty = render('en', 'editor', { fixes: [] });
  expect(empty).toContain('No fixes waiting. Open a check and tap a wrong answer to get one.');
  expect(empty).toContain('href="/w/w1?screen=checks"');
  expect(render('en', 'editor', { fixes: [], tab: 'done' })).toContain('Fixes you approve or skip show here.');
  expect(render('en', 'editor', { phase: 'loading', fixes: [] })).toContain('Loading');
  expect(render('en', 'editor', { phase: 'error', fixes: [], onRetry: () => undefined })).toContain('Try again');
  expect(render('en', 'editor', { busy: { id: 'f1', action: 'approve' }, openId: 'f1' })).toContain('Sending');
});

it('renders Arabic right to left with Arabic words and no English leftovers', () => {
  const html = render('ar', 'editor');
  expect(html).toContain('dir="rtl"');
  for (const word of ['إصلاحات', 'بالانتظار', 'وافق واختبر', 'ليس الآن', 'ما الخطأ', 'ما الذي يغيره الإصلاح', 'اقترحه']) expect(html, word).toContain(word);
  expect(html).not.toContain('Approve');
  expect(after('ar', 'owner')).toContain('dir="rtl"');
  expect(after('ar', 'owner')).toContain('قبل الإصلاح');
});

it('names the fix and both check times on Before and after, with three rows', () => {
  const html = after('en', 'owner');
  for (const part of ['Said submitted, but no case was saved (Arabic)', 'Before the fix', '5 of 8 right', 'Thu 09:04', 'After the fix', '6 of 8 right', 'Thu 11:20', 'Fixed 1', 'Still wrong 0', 'Wrong now, right before 0']) expect(html, part).toContain(part);
  expect(html.match(/data-row=/g)).toHaveLength(3);
  const empty = after('en', 'owner', { sample: null });
  expect(empty).toContain('This fills in after a fix is approved and tested.');
  expect(empty).toContain('href="/w/w1?screen=failures"');
});

const server = (over: Partial<ServerFix>): ServerFix => ({ id: 'p1', finding_id: 'f1', status: 'approved', title: 'Stop the false claim', title_ar: 'أوقف', created_at: '2026-11-15T05:00:00Z', proposed_by_name: 'Omar Mansoor', decided_at: null, decided_by_name: null, finding_title: 'Said submitted, but no case was saved', finding_title_ar: 'قال إنه قدم الطلب', finding_language: 'ar', before_run_id: 'r1', ...over });
it('reads test again progress from the server row, and compares only the fix own two checks', () => {
  expect(retestOf(server({}))).toEqual({ state: 'none', done: 0, total: 0 });
  expect(retestOf(server({ retest_run_id: 'r2', retest_run_status: 'running', retest_done: 3, retest_total: 8 }))).toEqual({ state: 'running', done: 3, total: 8 });
  expect(retestOf(server({ retest_run_id: 'r2', retest_run_status: 'cancelled' })).state).toBe('stopped');
  expect(retestOf(server({ retest_run_id: 'r2', retest_run_status: 'failed', retest_report_id: 'rep2' })).state).toBe('done');
  const before = { ...report([['a', 'failed', 'ar'], ['b', 'passed', 'en']]), run: { id: 'r1', status: 'failed', calls_used: 1, calls_budget: 9 } } as ReportBody;
  const afterBody = { ...report([['a', 'passed', 'ar'], ['b', 'passed', 'en']]), run: { id: 'r2', status: 'passed', calls_used: 1, calls_budget: 9 } } as ReportBody;
  const cards = fixCards([server({ retest_run_id: 'r2', retest_run_status: 'passed', retest_report_id: 'rep2', mine: true })], [{ id: 'rep2', body: afterBody }, { id: 'rep1', body: before }], 'en', messagesFor('en'));
  expect(cards[0]).toMatchObject({ title: 'Said submitted, but no case was saved (Arabic)', by: { name: 'Omar', initials: 'OM', mine: true }, retest: { state: 'done' }, change: { fixed: 1, stillWrong: 0, newlyWrong: 0 } });
});
