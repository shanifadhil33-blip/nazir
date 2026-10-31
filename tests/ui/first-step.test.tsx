import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fill, messagesFor, type Lang } from '../../src/components/ocean/copy';
import { canRunQuickCheck, emptyModel, firstStepFor, modelFromReports, rolesForSeat, type ScreenModel, type Seat } from '../../src/components/ocean/model';
import { WorkspaceScreen } from '../../src/components/ocean/screen';
import { assembleReport } from '../../src/server/reports/build';

const noop = () => {};
const handlers = { onScreen: noop, onLang: noop, onApprove: noop, onSkip: noop, onReplay: noop, onShare: noop, onSend: noop, onStop: noop, onRecheck: noop };
const base = { runs: 0, demo: false, preview: false, shared: false, agent: 'Agent', pack: 'Pack' };

function render(lang: Lang, seat: Seat, model: ScreenModel, options: { roles?: string[]; shared?: boolean; screen?: 'chat' | 'report' } = {}) {
  const copy = messagesFor(lang);
  return renderToStaticMarkup(<WorkspaceScreen lang={lang} copy={copy} demo={false} seat={seat} roles={options.roles ?? rolesForSeat(seat)} shared={options.shared} userName="Saeed" model={model} screen={options.screen ?? 'chat'} {...handlers} />);
}
function fresh(lang: Lang): ScreenModel {
  const copy = messagesFor(lang);
  return { ...emptyModel(copy, 'My workspace'), firstStep: firstStepFor({ ...base, agent: copy.ui.sampleAgent, pack: copy.settings.packNames.government }) };
}
function oneRun(lang: Lang): ScreenModel {
  const body = assembleReport({
    run: { id: '11111111-1111-4111-8111-111111111111', status: 'passed', calls_used: 3, calls_budget: 10, size: 'quick', test_count: 16 },
    conversations: [{ id: '22222222-2222-4222-8222-222222222222', status: 'passed', split: 'development', language: 'en', scenario_id: '33333333-3333-4333-8333-333333333333', attempt_number: 1 }],
    findings: [], messages: [],
  });
  return modelFromReports(body, null, messagesFor(lang), lang, 'My workspace', false);
}

describe('first step card visibility by state', () => {
  it('shows only in a real workspace with no runs', () => {
    expect(firstStepFor(base)).toEqual({ agent: 'Agent', pack: 'Pack' });
    expect(firstStepFor({ ...base, runs: 1 })).toBeNull();
    expect(firstStepFor({ ...base, runs: null })).toBeNull();
    expect(firstStepFor({ ...base, demo: true })).toBeNull();
    expect(firstStepFor({ ...base, preview: true })).toBeNull();
    expect(firstStepFor({ ...base, shared: true })).toBeNull();
  });

  it('is gone from the screen once a run exists', () => {
    for (const lang of ['en', 'ar'] as const) {
      const html = render(lang, 'owner', oneRun(lang));
      expect(html).not.toContain('data-state="first-step"');
      expect(html).not.toContain('data-action="first-quick"');
    }
  });
});

describe.each(['en', 'ar'] as const)('first step card by role in %s', (lang) => {
  const copy = messagesFor(lang);
  const sentence = fill(copy.ui.firstStepBody, { agent: copy.ui.sampleAgent, pack: copy.settings.packNames.government });

  it.each(['owner', 'editor'] as const)('gives the %s the Run Quick check action', (seat) => {
    const html = render(lang, seat, fresh(lang));
    expect(html).toContain('data-state="first-step"');
    expect(html).toContain(copy.ui.firstStepTitle);
    expect(html).toContain(sentence);
    expect(html).toContain(copy.ui.firstStepQuick);
    expect(html).toContain(`data-action="first-quick"`);
    expect(html).toContain(copy.ui.firstStepAction);
    expect(html).not.toContain(copy.ui.firstStepViewer);
    // The log no longer repeats the bare empty line under the card.
    expect(html).not.toContain(`</ol><p class="nz-empty">${copy.ui.noReport}</p>`);
    expect(render(lang, seat, { ...fresh(lang), firstStep: null })).toContain(`</ol><p class="nz-empty">${copy.ui.noReport}</p>`);
  });

  it.each(['viewer', 'supplier'] as const)('shows the %s the text only', (seat) => {
    const html = render(lang, seat, fresh(lang));
    expect(html).toContain('data-state="first-step"');
    expect(html).toContain(sentence);
    expect(html).not.toContain('data-action="first-quick"');
    expect(html).toContain(copy.ui.firstStepViewer);
  });

  it('hides the action on a shared view even for an owner', () => {
    expect(render(lang, 'owner', fresh(lang), { shared: true })).not.toContain('data-action="first-quick"');
  });

  it('gives an empty workspace the first report message instead of a zero report', () => {
    const html = render(lang, 'owner', fresh(lang), { screen: 'report' });
    expect(html).toContain('data-state="first-report"');
    expect(html).toContain(copy.ui.firstReport);
    expect(html).not.toContain('data-state="recheck-pending"');
    expect(html).not.toContain(copy.ui.share);
    expect(html).not.toContain(fill(copy.ui.coverageOne, { count: '0' }));
  });

  it('shows one run as a normal report with no before and after table', () => {
    const html = render(lang, 'owner', oneRun(lang), { screen: 'report' });
    expect(html).not.toContain('data-state="first-report"');
    expect(html).toContain('data-state="recheck-pending"');
    expect(html).toContain(copy.ui.share);
    expect(html).not.toContain(copy.ui.before);
  });
});

it('matches the server roles allowed to propose a plan', () => {
  expect(canRunQuickCheck(['service_owner'])).toBe(true);
  expect(canRunQuickCheck(['quality_reviewer'])).toBe(true);
  expect(canRunQuickCheck(['supplier_maintainer'])).toBe(false);
  expect(canRunQuickCheck(['viewer'])).toBe(false);
  expect(canRunQuickCheck(['service_owner'], true)).toBe(false);
});
