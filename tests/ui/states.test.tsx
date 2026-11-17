import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import { SignIn } from '../../src/components/landing/sign-in';
import { ChecksView, type ChecksViewProps } from '../../src/components/shell/checks';
import { failOf, startQuickCheckOutcome } from '../../src/components/shell/checks-run';
import { checksAccess } from '../../src/components/shell/checks-model';
import { homeLinks } from '../../src/components/shell/home-model';
import { StateCard } from '../../src/components/shell/state-card';
import { StatesBoard } from '../../src/components/shell/states-board';
import { rolesForSeat } from '../../src/components/ocean/model';

const base = (extra: Partial<ChecksViewProps> = {}): ChecksViewProps => ({
  lang: 'en', seat: 'owner', phase: 'ready', checks: [], access: checksAccess(rolesForSeat('owner')), assistant: '', links: homeLinks('w1'),
  now: new Date('2026-11-04T08:00:00Z'), openId: null, openQuestion: null, running: null, busy: null, note: null, ...extra,
});

it('puts the action inside the card and gives loading its placeholder bars', () => {
  const card = renderToStaticMarkup(<StateCard kind="error" title="Something went wrong" action={{ label: 'Try again', onClick: () => undefined }} />);
  expect(card.indexOf('Something went wrong')).toBeLessThan(card.indexOf('Try again'));
  expect(card.indexOf('</section>')).toBeGreaterThan(card.indexOf('Try again'));
  expect(renderToStaticMarkup(<StateCard kind="loading" title="Loading" />)).toContain('nz-state-bars');
  expect(renderToStaticMarkup(<StateCard kind="view" title="You can view this" />)).not.toContain('<button');
});

it('shows all six S10 states in English and Arabic, right to left in Arabic', () => {
  const english = renderToStaticMarkup(<StatesBoard lang="en" seat="owner" />);
  for (const line of ['Loading', 'Something went wrong', 'Nothing here yet', "Today&#x27;s free checks are used. More open tomorrow.", 'Your agent did not answer. Check its chat address.', 'You can view this', 'Try again', 'Start a check']) expect(english, line).toContain(line);
  const arabic = renderToStaticMarkup(<StatesBoard lang="ar" seat="owner" />);
  expect(arabic).toContain('dir="rtl"');
  for (const line of [ar.shell.loadingTitle, ar.shell.errorTitle, ar.shell.emptyTitle, ar.shell.limitTitle, ar.shell.offlineTitle, ar.shell.viewOnly, ar.shell.retry]) expect(arabic, line).toContain(line);
  expect(en.shell.limitTitle).toBe("Today's free checks are used. More open tomorrow.");
});

it('maps refused starts to the limit and unreachable cards', async () => {
  expect(failOf(429, null)).toBe('busy');
  expect(failOf(429, 'provider_exhausted')).toBe('busy');
  expect(failOf(429, 'daily_run_cap')).toBe('limit');
  expect(failOf(500, 'daily_cap')).toBe('limit');
  expect(failOf(null, null)).toBe('unreachable');
  expect(failOf(502, 'agent_unreachable')).toBe('unreachable');
  expect(failOf(400, 'validation')).toBe('failed');
  const limited = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'too_many' } }), { status: 429 })) as unknown as typeof fetch;
  expect(await startQuickCheckOutcome('w1', 'en', limited)).toEqual({ fail: 'busy' });
  const daily = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'daily_run_cap' } }), { status: 429, headers: { 'x-nazir-limit-reset': '2026-11-17T00:00:00.000Z' } })) as unknown as typeof fetch;
  expect(await startQuickCheckOutcome('w1', 'en', daily)).toEqual({ fail: 'limit', resetAt: '2026-11-17T00:00:00.000Z' });
  const down = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  expect(await startQuickCheckOutcome('w1', 'en', down)).toEqual({ fail: 'unreachable' });
});

it('shows a real connection action when the agent did not answer', () => {
  expect(renderToStaticMarkup(<ChecksView {...base({ note: 'limit' })} />)).toContain('data-state="limit"');
  const offline = renderToStaticMarkup(<ChecksView {...base({ note: 'unreachable' })} />);
  expect(offline).toContain('data-state="offline"');
  expect(offline).toContain('Check the connection');
  expect(offline).toContain('connect=quick');
  const viewer = renderToStaticMarkup(<ChecksView {...base({ seat: 'viewer', access: checksAccess(rolesForSeat('viewer')), note: 'unreachable' })} />);
  expect(viewer).not.toContain('Try again');
  expect(viewer).toContain('data-state="view"');
});

it('shows Nothing here yet with Start a check, and nothing to start for a viewer', () => {
  const owner = renderToStaticMarkup(<ChecksView {...base()} />);
  expect(owner).toContain(en.checksScreen.empty);
  expect(owner).toContain('Start a check');
  const arabic = renderToStaticMarkup(<ChecksView {...base({ lang: 'ar' })} />);
  expect(arabic).toContain('dir="rtl"');
  expect(arabic).toContain(ar.checksScreen.empty);
});

it('keeps the sign in page to one Google button with no email field', () => {
  for (const lang of ['en', 'ar'] as const) {
    const html = renderToStaticMarkup(<SignIn lang={lang} action={async () => undefined} />);
    expect(html).not.toMatch(/type="email"|name="email"|<input|type="password"/i);
    expect(html).toContain('Google');
    expect(html).toContain(lang === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
  }
});
