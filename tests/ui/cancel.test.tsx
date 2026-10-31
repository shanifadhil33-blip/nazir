import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import { messagesFor, type Lang } from '../../src/components/ocean/copy';
import { canCancel, emptyModel, rolesForSeat, type LogEvent, type Seat } from '../../src/components/ocean/model';
import { WorkspaceScreen } from '../../src/components/ocean/screen';

const noop = () => {};
const handlers = { onScreen: noop, onLang: noop, onApprove: noop, onSkip: noop, onReplay: noop, onShare: noop, onSend: noop, onStop: noop, onRecheck: noop, onCancel: noop };
const plan: LogEvent = { id: 'plan', kind: 'note', title: 'Nazir', body: 'Plan proposed.', cancel: { kind: 'plan', id: '11111111-1111-4111-8111-111111111111' } };
const run: LogEvent = { id: 'drive-progress', kind: 'note', title: 'Note', body: 'Running.', cancel: { kind: 'run', id: '22222222-2222-4222-8222-222222222222' } };

function render(lang: Lang, seat: Seat, shared = false) {
  const copy = messagesFor(lang);
  return renderToStaticMarkup(<WorkspaceScreen lang={lang} copy={copy} demo={false} seat={seat} roles={rolesForSeat(seat)} shared={shared} userName="Saeed" model={{ ...emptyModel(copy, 'Desk'), events: [plan, run] }} screen="chat" {...handlers} />);
}

it('shows cancel buttons on plan and run cards to owners and quality reviewers only', () => {
  for (const lang of ['en', 'ar'] as const) {
    const copy = messagesFor(lang);
    for (const seat of ['owner', 'editor'] as const) {
      const html = render(lang, seat);
      expect(html).toContain('data-action="cancel-plan"');
      expect(html).toContain('data-action="cancel-run"');
      expect(html).toContain(copy.ui.cancelPlan);
      expect(html).toContain(copy.ui.cancelRun);
    }
    for (const seat of ['supplier', 'viewer'] as const) expect(render(lang, seat)).not.toContain('data-action="cancel-');
    expect(render(lang, 'owner', true)).not.toContain('data-action="cancel-');
  }
  expect(canCancel(['service_owner'])).toBe(true);
  expect(canCancel(['quality_reviewer'])).toBe(true);
  expect(canCancel(['supplier_maintainer', 'viewer'])).toBe(false);
});

it('keeps English and Arabic interface keys in step', () => {
  expect(Object.keys(ar.ui).sort()).toEqual(Object.keys(en.ui).sort());
  for (const key of ['cancelPlan', 'cancelRun', 'planCancelled', 'runCancelled', 'runRetrying'] as const) expect(ar.ui[key]).toMatch(/[؀-ۿ]/);
});
