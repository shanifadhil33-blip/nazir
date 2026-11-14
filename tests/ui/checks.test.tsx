import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import { messagesFor, type Lang } from '../../src/components/ocean/copy';
import { rolesForSeat, type Seat } from '../../src/components/ocean/model';
import { ChecksView, type ChecksViewProps } from '../../src/components/shell/checks';
import { checkFromReport, checksAccess, dayLabel, markFor, progressLine, progressPercent, resultLabel } from '../../src/components/shell/checks-model';
import { planIdOf, runIdOf, startQuickCheck } from '../../src/components/shell/checks-run';
import { previewChecks } from '../../src/components/shell/checks-preview';
import { homeLinks } from '../../src/components/shell/home-model';
import { can, type Role } from '../../src/server/auth/roles';
import type { ReportBody } from '../../src/server/reports/build';

const now = new Date('2026-11-04T08:00:00Z');
const render = (lang: Lang, seat: Seat, extra: Partial<ChecksViewProps> = {}) => renderToStaticMarkup(
  <ChecksView lang={lang} seat={seat} phase="ready" checks={previewChecks(lang, now)} access={checksAccess(rolesForSeat(seat))} assistant="City Help Desk"
    links={homeLinks('w1')} now={now} openId={null} openQuestion={null} running={null} busy={null} note={null} {...extra} />,
);
const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;

it('follows the server role matrix for start, stop and suggest', () => {
  for (const role of ['service_owner', 'supplier_maintainer', 'quality_reviewer', 'viewer'] as Role[]) {
    const access = checksAccess([role]);
    expect(access.start, role).toBe(can([role], 'plan.propose'));
    expect(access.stop, role).toBe(can([role], 'plan.approve'));
    expect(access.suggest, role).toBe(can([role], 'proposal.create'));
  }
});

it('shows the running card with progress and a quiet stop to someone who may stop', () => {
  const html = render('en', 'owner', { running: { runId: 'r', done: 9, total: 16 } });
  expect(html).toContain('Checking now');
  expect(html).toContain('Checking now 9 of 16');
  expect(html).toContain('>Stop</button>');
  expect(html).toContain('aria-valuenow="56"');
  expect(html).toContain('Quick check, Today');
  expect(html).toContain('3 to fix');
  expect(html).toContain('all right');
});

it('hides Stop check when nothing runs and for a viewer', () => {
  expect(render('en', 'owner')).not.toContain('>Stop</button>');
  const viewer = render('en', 'viewer', { running: { runId: 'r', done: 1, total: 4 } });
  expect(viewer).toContain('Checking now');
  expect(viewer).not.toContain('>Stop</button>');
  expect(viewer).not.toContain('Start a check');
  expect(viewer).not.toContain('data-nav="start"');
});

it('shows Suggest a fix only on a wrong question for the role the server allows', () => {
  const open = { openId: 'quick', openQuestion: 'q1' };
  const supplier = render('en', 'supplier', open);
  expect(supplier).toContain('Suggest a fix');
  expect(supplier).toContain('Your assistant said');
  expect(supplier).toContain('The record says');
  for (const seat of ['owner', 'editor', 'viewer'] as Seat[]) expect(render('en', seat, open), seat).not.toContain('Suggest a fix');
  expect(render('en', 'supplier', { openId: 'quick', openQuestion: 'q4' })).not.toContain('Suggest a fix');
});

it('gives one chip per question and a way on for roles that cannot suggest', () => {
  const html = render('en', 'owner', { openId: 'quick' });
  expect(html.match(/data-chip="wrong"/g)).toHaveLength(3);
  expect(html.match(/data-chip="right"/g)).toHaveLength(1);
  expect(html.match(/data-chip="unsure"/g)).toHaveLength(1);
  expect(html).toContain('href="/w/w1?screen=failures"');
  expect(html).toContain('Quick check');
  expect(html).toContain('3 to fix');
});

it('uses one currency, AED, in the sample answers', () => {
  const all = JSON.stringify([previewChecks('en', now), previewChecks('ar', now)]);
  expect(all).not.toMatch(/\$|dollar|USD|EUR/i);
  expect(all).toContain('AED');
});

it('renders Arabic right to left with Arabic words', () => {
  const html = render('ar', 'supplier', { openId: 'quick', running: { runId: 'r', done: 9, total: 16 } });
  expect(render('ar', 'editor', { running: { runId: 'r', done: 9, total: 16 } })).toContain('إيقاف');
  expect(html).toContain('dir="rtl"');
  expect(html).toContain('lang="ar"');
  for (const word of ['نفحص الآن', 'نفحص الآن 9 من 16', 'قال مساعدك', 'السجل يقول', 'اقترح إصلاحاً', 'خطأ']) expect(html, word).toContain(word);
  expect(html).not.toContain('Checking now');
});

it('shows the loading, error and empty states with a way on', () => {
  expect(render('en', 'owner', { phase: 'loading' })).toContain('Loading');
  const error = render('en', 'owner', { phase: 'error', onRetry: () => undefined });
  expect(error).toContain('Something went wrong');
  expect(error).toContain('Try again');
  const empty = render('en', 'owner', { checks: [] });
  expect(empty).toContain('Nothing here yet');
  expect(empty).toContain('Start a check');
  expect(render('en', 'viewer', { checks: [] })).not.toContain('Start a check</');
});

it('keeps every new string free of dashes, caps, emoji and long lines in both languages', () => {
  for (const [lang, table] of [['en', en.checksScreen], ['ar', ar.checksScreen]] as const) {
    expect(Object.keys(table).sort(), lang).toEqual(Object.keys(en.checksScreen).sort());
    for (const [key, value] of Object.entries(table)) {
      expect(value, key).not.toMatch(/ - |[–—]|-/);
      expect(value, key).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(value, key).not.toMatch(/demo|api|mcp|judge|certified|compliant|verification|model/i);
      expect(value, key).not.toMatch(/\b[A-Z]{3,}\b/);
      expect(words(value), key).toBeLessThan(25);
    }
  }
  expect(messagesFor('ar').checksScreen.stopCheck).toBe(ar.checksScreen.stopCheck);
});

it('keeps the list and the check page under 25 words of copy', () => {
  const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const column = (html: string, start: string, end: string) => text(html.slice(html.indexOf(start), html.indexOf(end)));
  const list = render('en', 'owner', { running: { runId: 'r', done: 9, total: 16 } });
  const listText = column(list, 'class="nz-checks-list"', 'class="nz-check-page"');
  expect(words(listText)).toBeLessThan(25);
  const page = render('en', 'supplier', { openId: 'quick', checks: previewChecks('en', now).map((item) => ({ ...item, questions: item.questions.map((q) => ({ ...q, question: 'Q', said: 'A', record: 'R' })) })) });
  expect(words(column(page, 'class="nz-check-page"', '</section>'))).toBeLessThan(45);
  expect(list).not.toMatch(/Omar|Yusuf|Ahmed/);
});

it('words the check lines from real counts and days', () => {
  const copy = messagesFor('en');
  expect(resultLabel(3, copy)).toBe('3 to fix');
  expect(resultLabel(0, copy)).toBe('all right');
  expect(progressLine(9, 16, copy)).toBe('Checking now 9 of 16');
  expect(progressPercent(9, 16)).toBe(56);
  expect(progressPercent(0, 0)).toBe(0);
  expect(dayLabel(now, now, 'en', copy)).toBe('Today');
  expect(dayLabel(new Date(now.getTime() - 86_400_000), now, 'en', copy)).toBe('Yesterday');
  expect(dayLabel(new Date('2026-11-02T08:00:00Z'), now, 'en', copy)).toBe('Monday');
  expect(markFor('passed')).toBe('right');
  expect(markFor('failed')).toBe('wrong');
  expect(markFor('inconclusive')).toBe('unsure');
});

it('builds question rows from a saved report', () => {
  const body = {
    scope: { en: '', ar: '' }, run: { id: 'r', status: 'done', calls_used: 1, calls_budget: 9, size: 'quick' },
    counts: { conversations: 2, passed: 1, failed: 1, inconclusive: 0, findings: 1 },
    conversations: [
      { id: 'c1', status: 'failed', split: 'development', language: 'en', scenario_id: 's1', attempt_number: 1 },
      { id: 'c2', status: 'passed', split: 'development', language: 'en', scenario_id: 's2', attempt_number: 1 },
    ],
    findings: [{ id: 'f1', check_id: null, scenario_id: 's1', conversation_id: 'c1', severity: 'critical', title: 'Wrong fee', title_ar: null, really_happened: 'The fee is 300 AED.', really_happened_ar: null, split: 'development', family: 'x', language: 'en', agent_said: 'The fee is 200 AED.' }],
    messages: [
      { conversation_id: 'c1', seq: 1, speaker: 'resident', body: 'What is the fee?', split: 'development' },
      { conversation_id: 'c1', seq: 2, speaker: 'agent', body: 'The fee is 200 AED.', split: 'development' },
      { conversation_id: 'c2', seq: 1, speaker: 'resident', body: 'When does it open?', split: 'development' },
      { conversation_id: 'c2', seq: 2, speaker: 'agent', body: 'At eight.', split: 'development' },
    ],
    hidden_findings: 0, sentences: { en: [], ar: [] },
  } as unknown as ReportBody;
  const row = checkFromReport('id', '2026-11-04T08:00:00Z', body, 'en', messagesFor('en'));
  expect(row.kind).toBe('quick');
  expect(row.toFix).toBe(1);
  expect(row.questions.map((q) => [q.question, q.mark, q.findingId])).toEqual([['What is the fee?', 'wrong', 'f1'], ['When does it open?', 'right', null]]);
  expect(row.questions[0]!.said).toBe('The fee is 200 AED.');
  expect(row.questions[0]!.record).toBe('The fee is 300 AED.');
  expect(row.questions[1]!.record).toBe('');
});

it('starts a check with one server call and returns the run id', async () => {
  const run = '22222222-2222-4222-8222-222222222222';
  const calls: [string, RequestInit | undefined][] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push([String(url), init]);
    return new Response(JSON.stringify({ run_id: run, existing: false }), { status: 202 });
  }) as unknown as typeof fetch;
  expect(await startQuickCheck('w1', 'en', fetcher)).toBe(run);
  expect(calls).toHaveLength(1);
  expect(calls[0]![0]).toBe('/api/workspaces/w1/runs');
  expect(calls[0]![1]?.method).toBe('POST');
  expect(planIdOf({ id: 'nope' })).toBeNull();
  expect(runIdOf({ run_id: run })).toBe(run);
  const refused = vi.fn(async () => new Response(JSON.stringify({ done: false }), { status: 200 })) as unknown as typeof fetch;
  expect(await startQuickCheck('w1', 'en', refused)).toBeNull();
});

it('points the Checks nav item at the checks screen', () => {
  expect(homeLinks('w1').checks).toBe('/w/w1?screen=checks');
  expect(homeLinks('w1').start).toBe('/w/w1?screen=checks&start=1');
  expect(render('en', 'owner')).toContain('data-nav="checks" aria-current="page"');
});

it('keeps Start hidden when the current connection is not ready', () => {
  const html = render('en', 'owner', { access: { start: false, stop: true, suggest: true } });
  expect(html).not.toContain('data-nav="start"'); expect(html).not.toContain('nz-checks-start');
  expect(html).toContain('data-nav="checks" aria-current="page"');
});
