import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { messagesFor } from '../../src/components/ocean/copy';
import { metricsFromReport, sampleModel } from '../../src/components/ocean/model';
import { countAt, ScoreFigure } from '../../src/components/ocean/score-figure';
import { WorkspaceScreen } from '../../src/components/ocean/screen';
import { assembleReport, type ReportBody } from '../../src/server/reports/build';

const noop = () => {};
const handlers = { onScreen: noop, onLang: noop, onApprove: noop, onSkip: noop, onReplay: noop, onShare: noop, onSend: noop, onStop: noop };

function screen(lang: 'en' | 'ar', seat: 'owner' | 'editor' | 'supplier' | 'viewer', demo: boolean) {
  const copy = messagesFor(lang);
  return renderToStaticMarkup(<WorkspaceScreen lang={lang} copy={copy} demo={demo} seat={seat} userName={copy.sample.user} model={sampleModel(copy)} screen="chat" {...handlers} />);
}

it('shows the score count up final value', () => {
  expect(countAt(82, 0)).toBe(0);
  expect(countAt(82, 1)).toBe(82);
  expect(countAt(74, 1, 82)).toBe(74);
  const html = renderToStaticMarkup(<ScoreFigure value={82} named />);
  expect(html).toContain('data-score-final="82"');
  expect(html).toContain('>82<');
});

it('hides write controls for a viewer and shows the read only note', () => {
  const html = screen('en', 'viewer', true);
  expect(html).not.toContain('data-action="approve"');
  expect(html).not.toContain('data-action="edit"');
  expect(html).not.toContain('data-action="skip"');
  expect(html).not.toContain('data-action="replay"');
  expect(html).not.toContain('data-action="attach"');
  expect(html).toContain('You have view access. Ask an owner to run tests or approve fixes.');
  expect(html).toContain('>Viewer<');
  const owner = screen('en', 'owner', true);
  expect(owner).toContain('data-action="approve"');
  expect(owner).toContain('data-action="replay"');
  expect(owner).toContain('data-action="attach"');
  expect(owner).not.toContain('You have view access. Ask an owner to run tests or approve fixes.');
});

it('mirrors the shell when dir is rtl', () => {
  const html = screen('ar', 'owner', true);
  expect(html).toContain('dir="rtl"');
  expect(html).toContain('lang="ar"');
  expect(html).toContain('data-origin="right"');
  expect(html).toContain('سجل الوكيل');
  expect(html).toContain('بيانات تجريبية');
  expect(screen('en', 'owner', true)).toContain('data-origin="left"');
});

it('shows the sample data pill only for a demo workspace', () => {
  expect(screen('en', 'owner', true)).toContain('>Sample data<');
  expect(screen('en', 'owner', false)).not.toContain('>Sample data<');
  expect(screen('en', 'viewer', false)).not.toContain('>Sample data<');
  expect(screen('ar', 'owner', true)).toContain('>بيانات تجريبية<');
  expect(screen('ar', 'owner', false)).not.toContain('>بيانات تجريبية<');
});

it('derives the score from the saved report counts', () => {
  const body: ReportBody = assembleReport({
    run: { id: 'run', status: 'failed', calls_used: 2, calls_budget: 8 },
    conversations: [
      { id: 'c1', status: 'passed', split: 'development', language: 'en' },
      { id: 'c2', status: 'passed', split: 'development', language: 'ar' },
      { id: 'c3', status: 'failed', split: 'development', language: 'en' },
      { id: 'c4', status: 'failed', split: 'development', language: 'ar' },
    ],
    findings: [{ id: 'f1', check_id: null, severity: 'critical', title: 'Wrong queue', title_ar: null, really_happened: 'The case is in the wrong queue.', really_happened_ar: null, split: 'development', family: 'wrong_routing_queue', language: 'en' }],
    messages: [],
  });
  expect(metricsFromReport(body).score).toBe(50);
  expect(metricsFromReport(body).pass).toBe(2);
  expect(metricsFromReport(body).fail).toBe(2);
  expect(metricsFromReport(body).critical).toBe(1);
});
