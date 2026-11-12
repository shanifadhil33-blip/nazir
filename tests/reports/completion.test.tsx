import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { assembleReport, completionOf, isCompleteReport, projectReport, type ReportBody } from '../../src/server/reports/build';
import { clientReportSections } from '../../src/server/reports/pdf';
import { factsFromReports, headlineText } from '../../src/components/shell/report-model';
import { buildHistory, sentenceFor } from '../../src/components/shell/history-model';
import { checkFromReport } from '../../src/components/shell/checks-model';
import { measuredChange } from '../../src/components/shell/fixes-model';
import { messagesFor } from '../../src/components/ocean/copy';
import { ChecksView } from '../../src/components/shell/checks';
import { homeLinks } from '../../src/components/shell/home-model';

const now = new Date('2026-11-12T08:00:00Z');
const body = (status = 'failed', second = 'passed'): ReportBody => assembleReport({ run: { id: 'r', status, calls_used: 2, calls_budget: 8 }, conversations: [
  { id: 'one', scenario_id: 'a', status: 'failed', split: 'development', language: 'en' },
  { id: 'two', scenario_id: 'b', status: second, split: 'development', language: 'ar' },
], findings: [], messages: [] });
it('counts a completed check with wrong answers as complete, while stopped and partial checks have no overall score', () => {
  expect(completionOf(body())).toEqual({ complete: true, tries_done: 2, tries_total: 2 });
  for (const partial of [body('cancelled', 'cancelled'), body('failed', 'queued')]) {
    expect(isCompleteReport(partial)).toBe(false);
    const saved = [{ id: 'one', created_at: now.toISOString(), body: partial }];
    const facts = factsFromReports(saved, now)!;
    expect(facts.stopped).toEqual({ done: 1, total: 2 });
    expect(headlineText(facts, messagesFor('en'))).toBe('Stopped after 1 of 2');
    expect(headlineText(facts, messagesFor('ar'))).toBe('توقف الفحص بعد 1 من 2');
    expect(measuredChange(partial, body())).toBeNull();
    expect(measuredChange(body(), partial)).toBeNull();
    for (const lang of ['en', 'ar'] as const) {
      const pdf = clientReportSections(partial, { lang, fontBytes: new Uint8Array(), agentName: '', focusPack: '', runDate: '', before: { runId: 'before', counts: body().counts } });
      expect(pdf[0]!.title).toBe(headlineText(facts, messagesFor(lang)));
      expect(JSON.stringify(pdf)).not.toContain('/ 100');
      const item = buildHistory(saved, [], lang, messagesFor(lang))[0]!;
      expect(sentenceFor(item, messagesFor(lang))).toBe(messagesFor(lang).historyScreen.checkStopped);
    }
  }
});
it('shows unasked questions as Not checked and never labels a stopped row all right', () => {
  const stopped = body('cancelled', 'cancelled');
  const check = checkFromReport('one', now.toISOString(), stopped, 'en', messagesFor('en'));
  expect(check.questions[1]!.mark).toBe('notChecked');
  const html = renderToStaticMarkup(<ChecksView lang="en" seat="owner" phase="ready" checks={[check]} access={{ start: true, stop: true, suggest: false }} assistant="Sample" links={homeLinks('w')} now={now} openId="one" openQuestion="two" running={null} busy={null} note={null} />);
  expect(html).toContain('Stopped after 1 of 2'); expect(html).toContain('Not checked'); expect(html).not.toContain('all right');
});
it('ignores a stopped baseline when calculating measured improvement', () => {
  const saved = [body(), body('cancelled', 'cancelled')].map((item, i) => ({ id: String(i), created_at: now.toISOString(), body: item }));
  expect(factsFromReports(saved, now)?.fixedThisWeek).toBe(0);
});

it('keeps a partial check out of scores even when all its unasked questions are hidden in a projection', () => {
  const partial = body('failed', 'cancelled');
  partial.conversations[1]!.split = 'hidden';
  const projected = projectReport(partial, 'development');
  expect(projected.conversations).toHaveLength(1);
  expect(projected.completion?.complete).toBe(false);
  expect(isCompleteReport(projected)).toBe(false);
  expect(factsFromReports([{ id: 'r', body: projected, created_at: now.toISOString() }], now)?.stopped).toEqual({ done: 1, total: 1 });
});
