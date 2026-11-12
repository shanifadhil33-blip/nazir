import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import { ConnectCard, ConnectChoices, AgentStatus } from '../../src/components/shell/connect-card';
import { saveAndTestConnection } from '../../src/components/shell/connect-request';
import { ShellHome } from '../../src/components/shell/home';
import { buildHomeView, homeLinks } from '../../src/components/shell/home-model';
const home = '/w/test';
const facts = { checks: 0, right: 0, total: 0, score: 0, toFix: 0, lastAt: null };
it.each(['en', 'ar'] as const)('keeps exactly two connect choices and no Start or stats before a successful test in %s', (lang) => {
  const choices = renderToStaticMarkup(<ConnectChoices lang={lang} home={home} />);
  if (lang === 'ar') expect(choices).toContain('connect=full&amp;lang=ar');
  expect(choices.match(/class="nz-connect-choice"/g)).toHaveLength(2);
  expect(choices).toContain(`${home}?connect=full`); expect(choices).toContain(`${home}?connect=quick`);
  expect(choices.indexOf('connect=full')).toBeLessThan(choices.indexOf('connect=quick'));
  const page = renderToStaticMarkup(<ShellHome lang={lang} seat="owner" kind="real" workspaceId="test" view={buildHomeView(['service_owner'], facts, '', false)} links={homeLinks('test')} />);
  expect(page).not.toContain('data-nav="start"'); expect(page).not.toContain('data-nav="checks"'); expect(page).not.toContain('nz-stat-row');
  expect(page).toContain('href="/w/test?screen=settings"');
});
it('uses one honest replies setup for both choices with attached format and key choices', () => {
  for (const mode of ['full', 'quick'] as const) {
    const page = renderToStaticMarkup(<ConnectCard lang="en" workspaceId="test" mode={mode} home={home} />);
    expect(page).toContain('Save and send a test message'); expect(page).toContain('aria-haspopup="listbox"');
    expect(page).not.toContain('<select'); expect(page).not.toContain('Agent name');
    expect(page).not.toMatch(/NAZIR_KEY|download|tool calls|SHA256/);
    if (mode === 'full') expect(page).toContain(en.connect.sdkLater.replaceAll("'", '&#x27;'));
  }
});
it('shows demo connections read only without fields or writes', () => {
  const page = renderToStaticMarkup(<ConnectCard lang="en" workspaceId="test" mode="full" home={home} demo />);
  expect(page).toContain(en.connect.demoNote); expect(page).not.toContain('<form'); expect(page).not.toContain('<input');
});
it('saves then tests, quotes the plain reply and refetches status only after server truth', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ready: false })).mockResolvedValueOnce(Response.json({ ready: true, reply: 'Hello Omar' }));
  const result = await saveAndTestConnection('test', 'en', { endpoint: 'https://agent.example.com', format: 'simple_json' }, 'Hello', fetcher);
  expect(result).toEqual({ ok: true, reply: 'Hello Omar', card: undefined });
  expect(fetcher.mock.calls.map((c) => c[1].method)).toEqual(['PUT', 'POST']);
  expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ message: 'Hello', language: 'en' });
  expect(en.connect.success.replace('{reply}', result.ok ? result.reply : '')).toBe('Connected. Your agent replied: “Hello Omar”');
  const status = renderToStaticMarkup(<AgentStatus lang="en" home={home} connection={{ name: 'City Help Desk', host: 'agent.example.com', ready: true, tested_at: '2026-11-12T06:00:00Z' }} />);
  for (const line of ['Connected', 'Replies only', 'Chat address answers', 'Last tested', 'No SDK yet', 'Add the SDK', 'Change']) expect(status).toContain(line);
});
it('never enables readiness for save only, failed tests or a missing tested reply', async () => {
  const refused = vi.fn(async () => Response.json({ error: { code: 'validation' } }, { status: 400 }));
  expect((await saveAndTestConnection('test', 'ar', {}, '', refused)).ok).toBe(false); expect(refused).toHaveBeenCalledTimes(1);
  for (const test of [{ ready: false, reply: 'Hello' }, { ready: true }, { error: { code: 'external_changed' } }]) {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ready: false })).mockResolvedValueOnce(Response.json(test));
    expect((await saveAndTestConnection('test', 'ar', {}, 'Hello', fetcher)).ok).toBe(false);
  }
});
it('pairs all new copy in EN and AR and uses the approved simple wording', () => {
  for (const section of ['connect', 'agentStatus', 'sampleAgent'] as const) expect(Object.keys(en[section]).sort()).toEqual(Object.keys(ar[section]).sort());
  expect(en.connect.simple).toBe('Simple message and reply'); expect(ar.connect.simple).toBe('رسالة وجواب بسيطان');
  for (const file of [en, ar]) for (const value of [...Object.values(file.connect), ...Object.values(file.agentStatus)]) expect(value).not.toMatch(/ — | – | - |\b(owner|reviewer|supplier|viewer|builder|fixer|member|endpoint|workspace)\b/i);
});
