import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { messagesFor } from '../../src/components/ocean/copy';
import { AgentSettingsPanel, defaultSettings, type SettingsView } from '../../src/components/ocean/agent-settings';
import { rolesForSeat, sampleModel } from '../../src/components/ocean/model';
import { WorkspaceScreen } from '../../src/components/ocean/screen';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';

const noop = () => {};
const save = async () => null;
const owner: SettingsView = { ...defaultSettings('Amal Desk'), can_edit: true, llm: { provider: 'openai', model: 'gpt-4o-mini', base_url: 'https://api.openai.com/v1', key_last4: 'wxyz' }, mcp_servers: [{ name: 'Tickets', url: 'https://mcp.example.com/sse' }], integrations: ['slack'] };
const viewer: SettingsView = { ...defaultSettings('Amal Desk'), llm: { provider: 'openai', model: 'gpt-4o-mini', has_key: true }, mcp_servers: [{ name: 'Tickets', host: 'mcp.example.com' }] };

it('opens from the header and the agent card', () => {
  const copy = messagesFor('en');
  const html = renderToStaticMarkup(<WorkspaceScreen lang="en" copy={copy} demo seat="owner" roles={rolesForSeat('owner')} userName="Omar" model={sampleModel(copy)} screen="score"
    onScreen={noop} onLang={noop} onApprove={noop} onSkip={noop} onReplay={noop} onShare={noop} onSend={noop} onStop={noop} onRecheck={noop} onSettings={noop} />);
  expect(html).toContain('data-action="agent-settings"');
  expect(html).toContain('data-action="agent-card"');
});

it('shows the owner every control with only the masked key ending, in EN and AR', () => {
  for (const lang of ['en', 'ar'] as const) {
    const copy = messagesFor(lang);
    const html = renderToStaticMarkup(<AgentSettingsPanel copy={copy} lang={lang} settings={owner} sample={false} onClose={noop} onSave={save} />);
    expect(html).toContain('data-action="save-settings"');
    expect(html).toContain('name="api-key"');
    expect(html).toContain('•••• wxyz');
    expect(html).toContain('data-avatar="preset:6"');
    expect((html.match(/data-avatar="preset:/g) ?? []).length).toBe(6);
    expect(html).toContain('https://mcp.example.com/sse');
    expect(html).toContain(copy.settings.mcpNote);
    expect(html).toContain(copy.settings.notConnected);
    expect(html).toContain(lang === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
  }
});

it('keeps a viewer read only with no key field and no key ending', () => {
  const copy = messagesFor('en');
  const html = renderToStaticMarkup(<AgentSettingsPanel copy={copy} lang="en" settings={viewer} sample={false} onClose={noop} onSave={save} />);
  expect(html).not.toContain('data-action="save-settings"');
  expect(html).not.toContain('name="api-key"');
  expect(html).not.toContain('wxyz');
  expect(html).toContain(copy.settings.readOnly);
  expect(html).toContain(copy.settings.keyHidden);
  expect(html).toContain('mcp.example.com');
  expect(html).toContain('disabled=""');
});

it('has no dashes in settings copy', () => {
  const all = JSON.stringify([en.settings, ar.settings, en.ui.noFixToApprove, ar.ui.noFixToApprove]);
  expect(all).not.toMatch(/[\u2013\u2014]| - /);
});

it('shows the focus pack picker and the knowledge base card in EN and AR, with matching keys', () => {
  for (const lang of ['en', 'ar'] as const) {
    const copy = messagesFor(lang);
    const html = renderToStaticMarkup(<AgentSettingsPanel copy={copy} lang={lang} settings={{ ...owner, focus_pack: 'government' }} sample={false} onClose={noop} onSave={save} workspaceId="00000000-0000-4000-8000-000000000001" />);
    expect(html).toContain('data-card="focus-pack"');
    expect(html).toContain('data-pack="government"');
    expect(html).toContain('aria-checked="true" data-pack="government"');
    expect(html).toContain(copy.settings.packNames.government);
    expect(html).toContain('data-card="knowledge"');
    expect(html).toContain(copy.settings.kb);
    expect(html).not.toMatch(/optional|اختياري/i);
  }
  expect(Object.keys(en.settings).sort()).toEqual(Object.keys(ar.settings).sort());
  expect(Object.keys(en.settings.kbKinds)).toEqual(Object.keys(ar.settings.kbKinds));
});

it('counts knowledge parts with the right plural in EN and AR', async () => {
  const { partsLabel } = await import('../../src/components/ocean/knowledge');
  const e = messagesFor('en').settings; const a = messagesFor('ar').settings;
  expect([1, 2, 5].map((n) => partsLabel(e, n))).toEqual(['1 part', '2 parts', '5 parts']);
  expect([1, 2, 5, 12].map((n) => partsLabel(a, n))).toEqual(['جزء واحد', 'جزآن', '5 أجزاء', '12 جزءا']);
});

it('shows connection controls only to owners and a safe host line to other seats in both languages', () => {
  for (const lang of ['en', 'ar'] as const) {
    const copy=messagesFor(lang);
    const external_agent={ name:'Customer desk', host:'chat.example.com', ready:true, endpoint:'https://chat.example.com/chat', format:'simple_json' as const, header_name:'Authorization', key_saved:true, key_last4:'ABCD' };
    const html=renderToStaticMarkup(<AgentSettingsPanel copy={copy} lang={lang} settings={{...owner,external_agent}} sample={false} onClose={noop} onSave={save} workspaceId="workspace" />);
    expect(html).toContain(copy.settings.connect);
    expect(html).toContain('data-action="save-connection"');
    expect(html).toContain('data-action="test-connection"');
    expect(html).toContain('data-action="remove-connection"');
    expect(html).toContain('•••• ABCD');
    const read=renderToStaticMarkup(<AgentSettingsPanel copy={copy} lang={lang} settings={{...viewer,external_agent:{ name:external_agent.name,host:external_agent.host,ready:true }}} sample={false} onClose={noop} onSave={save} workspaceId="workspace" />);
    expect(read).toContain('chat.example.com');
    expect(read).not.toContain('ABCD');
    expect(read).not.toContain('data-action="test-connection"');
    expect(read).not.toContain('data-action="save-connection"');
    expect(read).not.toContain('data-action="remove-connection"');
  }
});
