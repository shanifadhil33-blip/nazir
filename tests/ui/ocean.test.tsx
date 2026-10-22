import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { messagesFor } from '../../src/components/ocean/copy';
import { canApprove, canRunRecheck, metricsFromReport, modelFromReports, rolesForSeat, sampleModel, type ScreenId, type ScreenModel, type Seat } from '../../src/components/ocean/model';
import { presentQuote, presentRecord } from '../../src/components/ocean/plain';
import { countAt, ScoreFigure } from '../../src/components/ocean/score-figure';
import { WorkspaceScreen } from '../../src/components/ocean/screen';
import { assembleReport, type ReportBody } from '../../src/server/reports/build';

const noop = () => {};
const handlers = { onScreen: noop, onLang: noop, onApprove: noop, onSkip: noop, onReplay: noop, onShare: noop, onSend: noop, onStop: noop, onRecheck: noop };
const receipt = '11111111-1111-4111-8111-111111111111';
const rawEn = `Case NZ-000001, requester Saeed (saeed), queue complaint review (complaint_review), status in review (in_review), review complaint review (complaint_review), waiting for review (pending_review). Receipt ${receipt}: create_case, succeeded (ok). Receipt 22222222-2222-4222-8222-222222222222: request_human_review, failed (error), the tool did not finish (tool_failed).`;
const rawAr = `الحالة NZ-000001، مقدم الطلب سعيد (saeed)، القائمة مراجعة الشكاوى (complaint_review)، الحالة قيد المراجعة (in_review)، المراجعة مراجعة الشكاوى (complaint_review)، بانتظار المراجعة (pending_review). الإيصال ${receipt}: create_case، نجحت (ok). الإيصال 22222222-2222-4222-8222-222222222222: request_human_review، فشلت (error)، لم تكمل الأداة العمل (tool_failed).`;

const withFix = (model: ScreenModel): ScreenModel => ({ ...model, failures: model.failures.map((item, index) => ({ ...item, proposalId: `44444444-4444-4444-8444-44444444444${index}` })) });

function screen(lang: 'en' | 'ar', seat: Seat, demo: boolean, options?: { roles?: string[]; shared?: boolean; screen?: ScreenId; model?: ScreenModel }) {
  const copy = messagesFor(lang);
  return renderToStaticMarkup(<WorkspaceScreen lang={lang} copy={copy} demo={demo} seat={seat} roles={options?.roles ?? rolesForSeat(seat)} shared={options?.shared} userName={copy.sample.user} model={options?.model ?? withFix(sampleModel(copy))} screen={options?.screen ?? 'chat'} {...handlers} />);
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
  expect(html).toContain('You have view access. Ask an owner to run tests, or a service quality reviewer to approve fixes.');
  expect(html).toContain('>Viewer<');
  const owner = screen('en', 'owner', true);
  expect(owner).not.toContain('data-action="approve"');
  expect(owner).toContain('Only a service quality reviewer can approve this fix.');
  expect(owner).toContain('data-action="replay"');
  expect(owner).toContain('data-action="attach"');
  expect(owner).not.toContain('You have view access. Ask an owner to run tests, or a service quality reviewer to approve fixes.');
  const editor = screen('en', 'editor', true);
  expect(editor).toContain('data-action="approve"');
  expect(editor).not.toContain('Only a service quality reviewer can approve this fix.');
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

it('keeps phone widths from overflowing (box sizing, shrinkable columns, wrapping report scores)', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  expect(css).toMatch(/\*, \*::before, \*::after \{ box-sizing: border-box; \}/);
  expect(css).toMatch(/\.nz-columns > \* \{ min-width: 0; \}/);
  expect(css).toMatch(/\.nz-report-scores \{ flex-wrap: wrap; \}/);
});

it('shows Approve only to a quality reviewer', () => {
  expect(canApprove(['service_owner'])).toBe(false);
  expect(canApprove(['supplier_maintainer'])).toBe(false);
  expect(canApprove(['viewer'])).toBe(false);
  expect(canApprove(['quality_reviewer'])).toBe(true);
  expect(canApprove(['service_owner', 'quality_reviewer'])).toBe(true);
  expect(canApprove(['quality_reviewer'], true)).toBe(false);
  expect(screen('en', 'owner', true, { roles: ['service_owner', 'quality_reviewer'] })).toContain('data-action="approve"');
  expect(screen('ar', 'supplier', true)).toContain('اعتماد هذا الإصلاح لمراجع جودة الخدمة فقط.');
  expect(screen('en', 'editor', true, { shared: true })).not.toContain('data-action="approve"');
  expect(screen('en', 'editor', true, { shared: true })).toContain('Only a service quality reviewer can approve this fix.');
});

it('renders record cards as sentences and keeps the raw lines behind an expand', () => {
  const spoken = presentRecord(rawEn, rawAr);
  expect(spoken.en).toContain('Case NZ-000001 for Saeed is in review in the complaint review queue');
  expect(spoken.en).toContain('The case tool succeeded.');
  expect(spoken.en).toContain('The review tool failed because the tool did not finish.');
  expect(spoken.ar).toContain('الحالة NZ-000001 تخص سعيد');
  expect(spoken.ar).toContain('نجحت أداة الحالة.');
  expect(spoken.ar).toContain('فشلت أداة المراجعة.');
  for (const sentence of [spoken.en, spoken.ar]) {
    expect(sentence).not.toContain(receipt);
    expect(sentence).not.toContain('create_case');
    expect(sentence).not.toContain('saeed)');
    expect(sentence).not.toContain('complaint_review');
    expect(sentence).not.toContain('tool_failed');
  }
  expect(spoken.rawEn).toContain(receipt);
  expect(spoken.rawAr).toContain('create_case');
  const plain = presentRecord('The case is in the wrong queue.', 'القضية في الطابور غير الصحيح.');
  expect(plain).toMatchObject({ en: 'The case is in the wrong queue.', ar: 'القضية في الطابور غير الصحيح.', rawEn: null, rawAr: null });
  const quiet = presentRecord('No case recorded. No tool was called.', 'لم تسجل أي حالة. لم تستدع أي أداة.');
  expect(quiet.rawEn).toBeNull();
  const hidden = presentRecord('Case NZ-9, requester other_user, queue secret_queue, status open (open), review none. Receipt 11111111-1111-4111-8111-111111111111: custom_tool, failed (error).', null);
  expect(hidden.en).toContain('the requester');
  expect(hidden.en).toContain('listed');
  expect(hidden.en).not.toContain('other_user');
  expect(hidden.en).not.toContain('secret_queue');
  expect(hidden.en).not.toContain('custom_tool');
  expect(hidden.en).not.toContain('11111111-1111-4111-8111-111111111111');
  expect(presentQuote('SAEED-SAID-DEV', { en: 'No reply was stored.', ar: 'لم يُحفظ رد.' })).toMatchObject({ en: 'The saved reply is a system code.', ar: 'الرد المحفوظ رمز من النظام.', raw: 'SAEED-SAID-DEV' });
  expect(presentQuote('Your refund will reach you today.', { en: 'No reply was stored.', ar: 'لم يُحفظ رد.' }).raw).toBeNull();

  const body: ReportBody = assembleReport({
    run: { id: 'run', status: 'failed', calls_used: 1, calls_budget: 4 },
    conversations: [{ id: 'c1', status: 'failed', split: 'development', language: 'en' }],
    findings: [{ id: 'f1', check_id: 'case_exists', severity: 'critical', title: 'Case recorded', title_ar: 'الحالة مسجلة', really_happened: rawEn, really_happened_ar: rawAr, split: 'development', family: 'complaint', language: 'en', agent_said: 'SAEED-SAID-DEV' }],
    messages: [],
  });
  const copy = messagesFor('en');
  const model = modelFromReports(body, null, copy, 'en', 'Harbor permits desk', true);
  expect(model.events.find((event) => event.id === 'f1')?.body).toBe(spoken.en);
  expect(model.events.find((event) => event.id === 'f1')?.detail).toBe(rawEn);
  expect(model.failures[0]?.actualEn).toBe('The saved reply is a system code.');
  expect(model.failures[0]?.rawQuote).toBe('SAEED-SAID-DEV');
  const html = screen('en', 'editor', true, { model, screen: 'failures' });
  expect(html).toContain(spoken.en);
  expect(html).toContain('>Record detail<');
  expect(html).toContain(receipt);
  expect(html).toContain('The saved reply is a system code.');
  const arabic = modelFromReports(body, null, messagesFor('ar'), 'ar', 'مكتب', true);
  expect(arabic.events.find((event) => event.id === 'f1')?.body).toBe(spoken.ar);
  expect(screen('ar', 'editor', true, { model: arabic })).toContain('تفاصيل السجل');
});

it('shows a recheck state instead of duplicate before and after scores', () => {
  expect(canRunRecheck(['service_owner'])).toBe(true);
  expect(canRunRecheck(['quality_reviewer'])).toBe(true);
  expect(canRunRecheck(['supplier_maintainer'])).toBe(false);
  expect(canRunRecheck(['viewer'])).toBe(false);
  expect(canRunRecheck(['service_owner'], true)).toBe(false);
  const copy = messagesFor('en');
  const base = sampleModel(copy);
  const pending = { ...base, before: null, failures: base.failures.map((item, index) => index === 0 ? { ...item, proposalId: '44444444-4444-4444-8444-444444444444' } : item) };
  const noFix = { ...base, before: null, failures: base.failures.map((item) => ({ ...item, proposalId: undefined })) };
  const ownerNoFix = screen('en', 'owner', true, { screen: 'report', model: noFix });
  expect(ownerNoFix).not.toContain('data-action="recheck"');
  expect(ownerNoFix).toContain('There is no approved fix to recheck yet.');
  const owner = screen('en', 'owner', true, { screen: 'report', model: pending });
  expect(owner).toContain('data-state="recheck-pending"');
  expect(owner).toContain('Recheck not run yet.');
  expect(owner).toContain('data-action="recheck"');
  expect(owner).not.toContain('<th>Before</th>');
  expect(owner).not.toContain('<th>After</th>');
  const viewer = screen('en', 'viewer', false, { screen: 'report', model: pending });
  expect(viewer).not.toContain('data-action="recheck"');
  expect(viewer).toContain('A service owner or a service quality reviewer runs the recheck.');
  expect(screen('ar', 'supplier', true, { screen: 'report', model: { ...sampleModel(messagesFor('ar')), before: null } })).toContain('لم تُشغل إعادة الفحص بعد.');
  const compared = screen('en', 'owner', true, { screen: 'report' });
  expect(compared).toContain('>Before<');
  expect(compared).toContain('>74<');
  expect(compared).toContain('>82<');
  expect(compared).not.toContain('data-state="recheck-pending"');
});

it('ends the failure entrance fully opaque and keeps a reduced motion fallback', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  expect(css).toMatch(/@keyframes nz-fade \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/);
  expect(css).toMatch(/@keyframes nz-rise \{ from \{ opacity: 0; transform: translateY\(12px\); \} to \{ opacity: 1; transform: none; \} \}/);
  expect(css).toMatch(/\.nz-cross \{ opacity: 1; animation: nz-fade 180ms ease forwards; \}/);
  expect(css).toMatch(/@keyframes nz-fill \{ from \{ transform: scaleX\(0\); \} to \{ transform: scaleX\(var\(--p\)\); \} \}/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  expect(reduced).toContain('animation: none;');
  expect(reduced).toContain('opacity: 1;');
  expect(reduced).toContain('.nz-cross');
  expect(reduced).toContain('.nz-failure');
  expect(countAt(82, 0)).toBe(0);
  expect(countAt(82, 0.5)).toBeGreaterThan(0);
  expect(countAt(82, 0.5)).toBeLessThan(82);
  expect(countAt(82, 1)).toBe(82);
});

it('hides approve, edit and skip when a failure has no proposed fix and says so in EN and AR', () => {
  for (const lang of ['en', 'ar'] as const) {
    const copy = messagesFor(lang);
    const noFix = sampleModel(copy);
    for (const seat of ['editor', 'owner', 'viewer'] as Seat[]) {
      for (const view of ['chat', 'failures'] as ScreenId[]) {
        const html = screen(lang, seat, true, { model: noFix, screen: view });
        expect(html).not.toContain('data-action="approve"');
        expect(html).not.toContain('data-action="edit"');
        expect(html).not.toContain('data-action="skip"');
        expect(html).not.toContain(copy.ui.reviewerDecides);
      }
    }
    const reviewer = screen(lang, 'editor', true, { model: noFix, screen: 'failures' });
    expect(reviewer).toContain('data-note="no-fix"');
    expect(reviewer).toContain(copy.ui.noFixToApprove);
    expect(copy.ui.noFixToApprove).not.toMatch(/[\u2013\u2014]| - /);
    const first = noFix.failures[0]!;
    for (const text of [first.expectedEn, first.expectedAr, first.actualEn, first.actualAr]) expect(reviewer).toContain(text);
    expect(screen(lang, 'editor', true, { screen: 'failures' })).toContain('data-action="approve"');
  }
});

it('shows repeat outcomes and flaky tags in the score and failure view in both languages', () => {
  const body = assembleReport({
    run: { id: 'run', status: 'failed', calls_used: 0, calls_budget: 24 },
    conversations: ['passed', 'failed', 'passed'].map((status, i) => ({ id: `attempt${i}`, scenario_id: 'case', status, language: 'en', split: 'development' })),
    findings: [{ id: 'f', scenario_id: 'case', check_id: 'right_queue', severity: 'high', title: 'Wrong queue', title_ar: 'طابور غير صحيح', really_happened: 'Wrong queue', really_happened_ar: 'طابور غير صحيح', split: 'development', family: 'routing', language: 'en' }], messages: [],
  });
  for (const lang of ['en', 'ar'] as const) {
    const copy = messagesFor(lang);
    const model = modelFromReports(body, null, copy, lang, 'Agent', false);
    expect(model.metrics.score).toBe(0);
    const html = screen(lang, 'owner', false, { model });
    const outcome = lang === 'en' ? 'passed 2 of 3' : 'نجح 2 من 3';
    expect(html.split(outcome).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain(copy.ui.flaky);
  }
});

it('offers the identical quick and full choices to existing roles in demo and signed in workspaces', () => {
  for (const lang of ['en', 'ar'] as const) for (const seat of ['owner', 'editor', 'supplier', 'viewer'] as const) {
    for (const demo of [true, false]) {
      const html = screen(lang, seat, demo);
      expect(html.includes('data-action="quick"')).toBe(seat !== 'viewer');
      expect(html.includes('data-action="replay"')).toBe(seat !== 'viewer');
      if (seat !== 'viewer') expect(html).toContain(messagesFor(lang).ui.quickCheck);
    }
  }
});
