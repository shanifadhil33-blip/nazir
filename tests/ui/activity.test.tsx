import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { activityFromEvent } from '../../src/server/shell/history';
import { historyFromActivity } from '../../src/components/shell/history-model';
import { messagesFor } from '../../src/components/ocean/copy';
import { HistoryView } from '../../src/components/shell/history';
import { homeLinks } from '../../src/components/shell/home-model';
import { ChecksView } from '../../src/components/shell/checks';
import { previewChecks } from '../../src/components/shell/checks-preview';
import { ReportView } from '../../src/components/shell/report';
import { factsFromReports, previewFacts } from '../../src/components/shell/report-model';
import { assembleReport } from '../../src/server/reports/build';

const now = new Date('2026-11-16T08:00:00Z');
const base = { seq: '12', at: now.toISOString(), action: 'run_finished', target_id: 'run1', decision: null, event_status: 'passed', report_id: 'report1', run_id: 'run1', fix_id: null, title: null, title_ar: null, right: 6, total: 8, done: 8, status: 'passed' };
it('maps every user facing audit milestone to plain copy and its own item', () => {
  const variants = [
    ['run_finished', 'checkDone', 'check=report1'], ['run_enqueued', 'checkStarted', 'check=report1'],
    ['proposal.create', 'suggested', 'fix=run1'], ['proposal.decide', 'approved', 'fix=run1'],
    ['proposal.retest', 'testStarted', 'fix=run1'], ['member.language', 'languageChanged', 'screen=settings'],
    ['agent.settings_saved', 'settingsChanged', 'screen=settings'], ['demo.reset', 'sampleReset', '/w/w'],
    ['safety.finished', 'safetyDone', 'safety=run1'], ['safety.stopped', 'safetyStopped', 'safety=run1'],
    ['safety.started', 'safetyStarted', 'safety=run1'], ['safety.fix_approved', 'safetyFixed', 'tab=safety'],
    ['plan.proposed', 'questionsReady', 'screen=checks'],
  ];
  for (const [action, kind, href] of variants) {
    const event = activityFromEvent({ ...base, action: action!, decision: 'approve' }, '/w/w');
    expect(event.kind).toBe(kind); expect(event.href).toContain(href);
    for (const lang of ['en', 'ar'] as const) {
      const copy = messagesFor(lang);
      const html = renderToStaticMarkup(<HistoryView lang={lang} seat="owner" phase="ready" allowed items={historyFromActivity([event], lang, copy)} now={now} older={false} assistant="Desk" canStart links={homeLinks('w')} />);
      expect(html).toContain(copy.historyScreen[kind as keyof typeof copy.historyScreen]);
      expect(html).toContain(`lang=${lang}`);
    }
  }
  expect(activityFromEvent({ ...base, event_status: 'cancelled' }, '/w/w').kind).toBe('checkStopped');
  expect(activityFromEvent({ ...base, fix_id: 'fix' }, '/w/w').kind).toBe('testDone');
  expect(activityFromEvent({ ...base, action: 'proposal.decide', decision: 'reject' }, '/w/w').kind).toBe('turnedDown');
});

it('filters answers to the counted verdict or comparison set and does not open a question absent from the URL', () => {
  for (const lang of ['en', 'ar'] as const) {
    const checks = previewChecks(lang, now);
    const view = (filter: 'wrong' | 'right' | 'unsure', questionIds?: string[]) => renderToStaticMarkup(<ChecksView lang={lang} seat="owner" phase="ready" checks={checks} assistant="Desk" access={{ start: true, stop: true, suggest: true }} now={now} links={homeLinks('w')} openId="quick" openQuestion={null} running={null} busy={null} note={null} filter={filter} questionIds={questionIds} />);
    expect(view('wrong').match(/class="nz-question"/g)).toHaveLength(3);
    expect(view('right').match(/class="nz-question"/g)).toHaveLength(1);
    expect(view('unsure').match(/class="nz-question"/g)).toHaveLength(1);
    expect(view('wrong')).not.toContain('data-open="true"');
    expect(view('wrong', ['q1']).match(/class="nz-question"/g)).toHaveLength(1);
    expect(view('wrong', [])).toContain(messagesFor(lang).checksScreen.noneHere);
  }
});

it('names a requested report, ignores newer stopped checks by default, and never substitutes another requested id', () => {
  const body = (id: string, status: 'passed' | 'cancelled') => assembleReport({ run: { id, status, calls_used: 0, calls_budget: 8 }, conversations: [{ id: 'q', scenario_id: 's', language: 'en', status: status === 'passed' ? 'passed' : 'cancelled', split: 'development' }], findings: [], messages: [] });
  const reports = [{ id: 'stopped', created_at: now.toISOString(), body: body('a', 'cancelled') }, { id: 'done', created_at: now.toISOString(), body: body('b', 'passed') }];
  expect(factsFromReports(reports, now)?.id).toBe('done');
  expect(factsFromReports(reports, now, 'stopped')?.stopped).toBeDefined();
  expect(factsFromReports(reports, now, 'missing')).toBeNull();
});

it('links report rows to the right buckets and offers a manual share fallback without marking History current', () => {
  const facts = { ...previewFacts(now), unsure: 3, baseId: 'base' };
  const html = renderToStaticMarkup(<ReportView lang="en" seat="owner" phase="ready" facts={facts} workspaceId="w" assistant="Desk" canStart history links={homeLinks('w')} now={now} note="shareFailed" shareUrl="https://example.test/report" />);
  for (const part of ['change=fixed', 'from=base', 'show=wrong', 'show=unsure', 'Copy this link', 'value="https://example.test/report"']) expect(html).toContain(part);
  expect(html).not.toContain('aria-current="page"');
});

it('opens the specific suggested fix from its answer', () => {
  const checks = previewChecks('en', now);
  const finding = checks.find((c) => c.id === 'quick')!.questions.find((q) => q.id === 'q1')!.findingId!;
  const html = renderToStaticMarkup(<ChecksView lang="en" seat="owner" phase="ready" checks={checks} assistant="Desk" access={{ start: true, stop: true, suggest: true }} now={now} links={homeLinks('w')} openId="quick" openQuestion="q1" running={null} busy={null} note={null} fixFor={{ [finding]: 'exact-fix' }} />);
  expect(html).toContain('href="/w/w?screen=failures&amp;fix=exact-fix"');
});
