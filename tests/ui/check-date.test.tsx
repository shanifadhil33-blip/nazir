import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { checkDate } from '../../src/server/reports/date';
import { assembleReport, projectReport, type ReportBody } from '../../src/server/reports/build';
import { checkFromReport, dayLabel } from '../../src/components/shell/checks-model';
import { buildHistory, groupByDay } from '../../src/components/shell/history-model';
import { lastCheckText } from '../../src/components/shell/home-model';
import { factsFromReports } from '../../src/components/shell/report-model';
import { HomeScreen } from '../../src/components/shell/home-screen';
import { MemberSnapshotProvider, type MemberSnapshot } from '../../src/components/shell/member-snapshot';
import { messagesFor } from '../../src/components/ocean/copy';

const made = '2026-11-12T08:00:00Z';
const started = '2026-11-08T23:00:00Z';
const ended = '2026-11-09T08:00:00Z';
const now = new Date(made);
const report = (run: Partial<ReportBody['run']> = {}, mark = 'passed') => assembleReport({ run: { id: 'run', status: 'passed', calls_used: 1, calls_budget: 8, ...run }, conversations: [{ id: 'c', scenario_id: 's', status: mark, language: 'en', split: 'development' }], findings: [], messages: [] });
afterEach(() => vi.useRealTimers());

it.each([
  [{ finished_at: ended, started_at: started }, ended],
  [{ finished_at: ended, started_at: null }, ended],
  [{ finished_at: null, started_at: started }, started],
  [{ finished_at: null, started_at: null }, made],
  [{}, made],
])('prefers finish, then start, then report creation for %j', (dates, expected) => {
  expect(checkDate(made, report(dates)).getTime()).toBe(new Date(expected).getTime());
});

it.each(['en', 'ar'] as const)('dates a stopped 9 Nov check reported on 12 Nov correctly across %s models', (lang) => {
  const copy = messagesFor(lang);
  const body = report({ status: 'cancelled', finished_at: ended, started_at: null }, 'cancelled');
  const check = checkFromReport('r', made, body, lang, copy);
  expect(check.at.toISOString()).toBe(new Date(ended).toISOString());
  expect(check.stopped).toEqual({ done: 0, total: 1 });
  expect(dayLabel(check.at, now, lang, copy)).not.toBe(copy.checksScreen.today);
  const history = buildHistory([{ id: 'r', created_at: made, body }], [], lang, copy);
  expect(history[0]!.kind).toBe('checkStopped');
  expect(groupByDay(history, now).today).toHaveLength(0);
  expect(groupByDay(history, now).earlier[0]!.at).toEqual(check.at);
  expect(lastCheckText(check.at, now, copy)).not.toBe(copy.shell.today);
  expect(factsFromReports([{ id: 'r', created_at: made, body }], now)?.at).toEqual(check.at);
});

it.each(['en', 'ar'] as const)('Home uses the completed check date and ignores a newer stopped score in %s', (lang) => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const snapshot: MemberSnapshot = { workspaceId: 'w', lang, roles: ['service_owner'], assistant: 'City Help Desk', person: undefined, fullName: '', settings: null, fixes: [], reports: [
    { id: 'stopped', created_at: made, body: report({ status: 'cancelled', finished_at: made, started_at: null }, 'cancelled') },
    { id: 'done', created_at: made, body: report({ finished_at: ended, started_at: started }) },
  ] };
  const html = renderToStaticMarkup(<MemberSnapshotProvider value={snapshot}><HomeScreen workspaceId="w" initialLang={lang} /></MemberSnapshotProvider>);
  expect(html).toContain(lastCheckText(new Date(ended), now, messagesFor(lang)));
  expect(html).not.toContain(messagesFor(lang).shell.noChecksYet);
});

it('weekly improvement uses check dates so a late old report does not count as this week', () => {
  const latest = { id: 'latest', created_at: made, body: report({ finished_at: made }) };
  const old = { id: 'old', created_at: made, body: report({ finished_at: '2026-11-01T08:00:00Z', started_at: null }, 'failed') };
  expect(factsFromReports([latest, old], now)?.fixedThisWeek).toBe(0);
  const thisWeek = { ...old, body: report({ finished_at: ended }, 'failed') };
  expect(factsFromReports([latest, thisWeek, old], now)?.fixedThisWeek).toBe(1);
});

it('assembly and role projection preserve both timestamps', () => {
  const body = report({ finished_at: ended, started_at: started });
  expect(body.run).toMatchObject({ finished_at: ended, started_at: started });
  expect(projectReport(body, 'development').run).toMatchObject({ finished_at: ended, started_at: started });
});
