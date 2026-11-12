import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { messagesFor } from '../../src/components/ocean/copy';
import { modelFromReports } from '../../src/components/ocean/model';
import { checkFromReport, checksAccess } from '../../src/components/shell/checks-model';
import { ChecksView } from '../../src/components/shell/checks';
import { measuredChange } from '../../src/components/shell/fixes-model';
import { factsFromReports } from '../../src/components/shell/report-model';
import { ReportView } from '../../src/components/shell/report';
import { homeLinks } from '../../src/components/shell/home-model';
import { assembleReport, projectReport } from '../../src/server/reports/build';

const now = new Date('2026-11-12T08:00:00Z');
const make = (passed: boolean, sample = false) => ({ ...assembleReport({
  run: { id: 'check', status: 'failed', calls_used: 0, calls_budget: 10 },
  conversations: [{ id: 'question', scenario_id: 'one', status: passed ? 'passed' : 'failed', language: 'en', split: 'development' }], findings: [], messages: [],
}), sample });

it.each(['en', 'ar'] as const)('labels seeded checks and reports in %s', (lang) => {
  const copy = messagesFor(lang);
  const body = make(true, true);
  const check = checkFromReport('one', now.toISOString(), body, lang, copy);
  const checks = renderToStaticMarkup(<ChecksView lang={lang} seat="owner" phase="ready" checks={[check]} access={checksAccess(['service_owner'])} assistant="City Help Desk" links={homeLinks('w')} now={now} openId="one" openQuestion={null} running={null} busy={null} note={null} />);
  expect(checks).toContain(copy.shell.sample);
  const facts = factsFromReports([{ id: 'one', created_at: now.toISOString(), body }], now);
  const report = renderToStaticMarkup(<ReportView lang={lang} seat="owner" phase="ready" facts={facts} workspaceId="w" assistant="City Help Desk" canStart history links={homeLinks('w')} now={now} note={null} />);
  expect(report).toContain(copy.shell.sample);
  expect(projectReport(body, 'development').sample).toBe(true);
});
it('never counts a difference between samples as a fix or a measured before and after', () => {
  const before = make(false, true), after = make(true, true);
  expect(measuredChange(before, after)).toBeNull();
  expect(measuredChange(make(false), after)).toBeNull();
  expect(measuredChange(before, make(true))).toBeNull();
  expect(measuredChange(make(false), make(true))?.fixed).toBe(1);
  const saved = [after, before].map((body, i) => ({ id: String(i), created_at: now.toISOString(), body }));
  expect(factsFromReports(saved, now)).toMatchObject({ sample: true, fixedThisWeek: 0 });
  const model = modelFromReports(after, before, messagesFor('en'), 'en', 'City Help Desk', false);
  expect(model.sample).toBe(true);
  expect(model.before).toBeNull();
});
