'use client';

import { useEffect, useRef, useState } from 'react';
import { fill, type Lang, type Messages } from './copy';
import { KnowledgeCard } from './knowledge';

export type SettingsView = {
  name: string | null; instructions: string; language: Lang; avatar: string; focus_pack?: string;
  mcp_servers: { name: string; url?: string; host?: string | null }[]; integrations: string[];
  llm: { provider: Provider; model: string; base_url?: string | null; key_last4?: string | null; has_key?: boolean } | null; can_edit: boolean;
};
type Provider = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'groq' | 'custom';
const providers: Provider[] = ['openai', 'anthropic', 'gemini', 'openrouter', 'groq', 'custom'];
const apps = ['slack', 'gmail', 'google_drive', 'github', 'notion', 'microsoft_teams', 'whatsapp_business', 'zendesk'] as const;
const presets = ['preset:1', 'preset:2', 'preset:3', 'preset:4', 'preset:5', 'preset:6'];
const palette = [['#0e7c86', '#5fd3c8'], ['#126e8f', '#8fe3f0'], ['#0b5f73', '#ff8a70'], ['#1a8f9c', '#c7f5ef'], ['#0d6d7a', '#ffb199'], ['#14809b', '#7fe0d6']];

export function AgentAvatar({ value, size = 40 }: { value: string; size?: number }) {
  // A data address checked on the server (PNG, JPEG or WebP bytes); next/image adds nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  if (value.startsWith('data:image/')) return <img className="nz-avatar" src={value} alt="" width={size} height={size} />;
  const index = Math.max(0, presets.indexOf(value));
  const [a, b] = palette[index]!;
  const id = `nzav${index}`;
  const shapes = [
    <path key="s" d="M6 26c6-8 12 4 18-4s10 2 10 2v10H6z" fill="#fff" opacity=".85" />,
    <path key="s" d="M20 7l12 22H8z" fill="#fff" opacity=".85" />,
    <g key="s" fill="none" stroke="#fff" strokeWidth="3" opacity=".9"><circle cx="20" cy="20" r="9" /><circle cx="29" cy="11" r="3" fill="#fff" /></g>,
    <g key="s" fill="#fff" opacity=".85"><rect x="8" y="12" width="24" height="5" rx="2.5" /><rect x="12" y="21" width="16" height="5" rx="2.5" /></g>,
    <path key="s" d="M20 6l12 8v12l-12 8-12-8V14z" fill="#fff" opacity=".85" />,
    <g key="s" fill="#fff" opacity=".9"><circle cx="20" cy="20" r="4" /><circle cx="20" cy="20" r="10" fill="none" stroke="#fff" strokeWidth="2" /></g>,
  ];
  return <svg className="nz-avatar" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient></defs>
    <rect width="40" height="40" rx="12" fill={`url(#${id})`} />{shapes[index]}
  </svg>;
}

export const defaultSettings = (name: string): SettingsView => ({ name, instructions: '', language: 'en', avatar: 'preset:1', mcp_servers: [], integrations: [], llm: null, can_edit: false });

export type PackView = { id: string; cases: number; record_checks: number; refusal_policies: number; compliance: number };
const fallbackPacks: PackView[] = [{ id: 'government', cases: 48, record_checks: 7, refusal_policies: 3, compliance: 5 }];

export function AgentSettingsPanel({ copy, lang, settings, sample, onClose, onSave, workspaceId, packs = fallbackPacks }: {
  workspaceId?: string; packs?: PackView[];
  copy: Messages; lang: Lang; settings: SettingsView; sample: boolean; onClose: () => void;
  onSave: (body: unknown) => Promise<SettingsView | null>;
}) {
  const t = copy.settings;
  const edit = settings.can_edit;
  const [name, setName] = useState(settings.name ?? '');
  const [instructions, setInstructions] = useState(settings.instructions);
  const [language, setLanguage] = useState<Lang>(settings.language);
  const [avatar, setAvatar] = useState(settings.avatar);
  const [pack, setPack] = useState(settings.focus_pack ?? 'government');
  const [servers, setServers] = useState(settings.mcp_servers.map((s) => ({ name: s.name, url: s.url ?? '' })));
  const [serverName, setServerName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [chosen, setChosen] = useState<string[]>(settings.integrations);
  const [provider, setProvider] = useState<Provider | ''>(settings.llm?.provider ?? '');
  const [modelId, setModelId] = useState(settings.llm?.model ?? '');
  const [baseUrl, setBaseUrl] = useState(settings.llm?.provider === 'custom' ? settings.llm.base_url ?? '' : '');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'image'>('idle');
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input,button')?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  function upload(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 200 * 1024) { setState('image'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') { setAvatar(reader.result); setState('idle'); } };
    reader.readAsDataURL(file);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!edit) return;
    setState('saving');
    const body = {
      name: name.trim() || settings.name || 'Nazir', instructions, language, avatar, focus_pack: pack, mcp_servers: servers, integrations: chosen,
      llm: provider ? { provider, model: modelId.trim(), ...(provider === 'custom' ? { base_url: baseUrl.trim() } : {}), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}), ...(clearKey ? { clear_key: true } : {}) } : null,
    };
    const result = await onSave(body);
    if (result) { setApiKey(''); setClearKey(false); setState('saved'); } else setState('failed');
  }

  const last4 = settings.llm?.key_last4;
  return <div className="nz-settings-back" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="nz-settings nz-enter" role="dialog" aria-modal="true" aria-labelledby="nz-settings-title" ref={dialog} lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="nz-settings-head">
        <div className="nz-settings-who"><AgentAvatar value={avatar} size={48} /><div><h2 id="nz-settings-title">{t.title}</h2><p>{name || settings.name}</p></div></div>
        <button type="button" className="nz-btn nz-btn-ghost" data-action="close-settings" onClick={onClose}>{t.close}</button>
      </div>
      {!edit ? <p className="nz-note" data-note="settings-read-only">{t.readOnly}</p> : null}
      {sample ? <p className="nz-note" data-note="settings-sample">{t.sampleNote}</p> : null}
      <form className="nz-settings-grid" onSubmit={save}>
        <fieldset disabled={!edit} className="nz-settings-card">
          <label>{t.name}<input name="agent-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
          <label>{t.instructions}<textarea name="instructions" value={instructions} maxLength={2000} rows={5} onChange={(e) => setInstructions(e.target.value)} /></label>
          <p className="nz-hint">{t.instructionsHint}</p>
          <div role="radiogroup" aria-label={t.language} className="nz-seg">
            <span>{t.language}</span>
            <button type="button" role="radio" aria-checked={language === 'en'} onClick={() => setLanguage('en')}>{t.english}</button>
            <button type="button" role="radio" aria-checked={language === 'ar'} onClick={() => setLanguage('ar')}>{t.arabic}</button>
          </div>
        </fieldset>
        <fieldset disabled={!edit} className="nz-settings-card">
          <legend>{t.avatar}</legend>
          <div className="nz-avatars" role="radiogroup" aria-label={t.avatar}>
            {presets.map((preset, index) => <button type="button" key={preset} role="radio" aria-checked={avatar === preset} aria-label={t.avatarNames[index]} data-avatar={preset} onClick={() => setAvatar(preset)}><AgentAvatar value={preset} size={52} /></button>)}
            {avatar.startsWith('data:') ? <button type="button" role="radio" aria-checked="true" aria-label={t.custom}><AgentAvatar value={avatar} size={52} /></button> : null}
          </div>
          <label className="nz-upload">{t.upload}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e.target.files?.[0])} /></label>
          <p className="nz-hint">{state === 'image' ? t.uploadTooBig : t.uploadHint}</p>
        </fieldset>
        <fieldset disabled={!edit} className="nz-settings-card" data-card="focus-pack">
          <legend>{t.pack}</legend>
          <p className="nz-hint">{t.packHint}</p>
          <div className="nz-packs" role="radiogroup" aria-label={t.pack}>
            {packs.map((p) => <button type="button" key={p.id} role="radio" aria-checked={pack === p.id} data-pack={p.id} onClick={() => setPack(p.id)}>
              <strong>{t.packNames[p.id as keyof typeof t.packNames] ?? p.id}</strong>
              <small>{fill(t.packCounts, { cases: String(p.cases), checks: String(p.record_checks), policies: String(p.refusal_policies), compliance: String(p.compliance) })}</small>
            </button>)}
          </div>
        </fieldset>
        <fieldset disabled={!edit} className="nz-settings-card">
          <legend>{t.apps}</legend>
          <h3>{t.mcp}</h3>
          <ul className="nz-servers">{(edit ? servers : settings.mcp_servers.map((s) => ({ name: s.name, url: s.host ?? '' }))).map((server, index) => <li key={`${server.name}-${index}`}><strong>{server.name}</strong><span dir="ltr">{server.url}</span>{edit ? <button type="button" className="nz-btn nz-btn-ghost" onClick={() => setServers(servers.filter((_, i) => i !== index))}>{t.remove}</button> : null}</li>)}</ul>
          {edit ? <div className="nz-row">
            <input aria-label={t.mcpName} placeholder={t.mcpName} value={serverName} maxLength={60} onChange={(e) => setServerName(e.target.value)} />
            <input aria-label={t.mcpUrl} placeholder={t.mcpUrl} dir="ltr" value={serverUrl} maxLength={300} onChange={(e) => setServerUrl(e.target.value)} />
            <button type="button" className="nz-btn nz-btn-ghost" data-action="add-mcp" disabled={!serverName.trim() || !/^https:\/\//.test(serverUrl.trim()) || servers.length >= 10} onClick={() => { setServers([...servers, { name: serverName.trim(), url: serverUrl.trim() }]); setServerName(''); setServerUrl(''); }}>{t.mcpAdd}</button>
          </div> : null}
          <p className="nz-hint">{t.mcpNote}</p>
          <h3>{t.integrations}</h3>
          <div className="nz-apps">{apps.map((app) => <label key={app} className="nz-app-chip"><input type="checkbox" checked={chosen.includes(app)} onChange={(e) => setChosen(e.target.checked ? [...chosen, app] : chosen.filter((a) => a !== app))} /><span>{t.apps_list[app]}</span>{chosen.includes(app) ? <small>{t.notConnected}</small> : null}</label>)}</div>
          <p className="nz-hint">{t.integrationsNote}</p>
        </fieldset>
        <fieldset disabled={!edit} className="nz-settings-card">
          <legend>{t.model}</legend>
          <p className="nz-hint">{t.modelHint}</p>
          <label>{t.provider}<select name="provider" value={provider} onChange={(e) => setProvider(e.target.value as Provider | '')}><option value="">{t.none}</option>{providers.map((p) => <option key={p} value={p}>{t.providers[p]}</option>)}</select></label>
          {provider ? <>
            <label>{t.modelId}<input name="model" dir="ltr" value={modelId} maxLength={120} onChange={(e) => setModelId(e.target.value)} /></label>
            {provider === 'custom' ? <label>{t.baseUrl}<input name="base-url" dir="ltr" value={baseUrl} maxLength={300} onChange={(e) => setBaseUrl(e.target.value)} /></label> : null}
            {edit ? <label>{t.apiKey}<input name="api-key" type="password" autoComplete="off" dir="ltr" value={apiKey} placeholder={last4 ? t.keyNew : ''} onChange={(e) => setApiKey(e.target.value)} /></label> : null}
            {last4 ? <p className="nz-hint" data-key-mask="true">{fill(t.keySaved, { last4: `•••• ${last4}` })}</p> : !edit && settings.llm?.has_key ? <p className="nz-hint">{t.keyHidden}</p> : null}
            {edit && last4 ? <label className="nz-app-chip"><input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /><span>{t.clearKey}</span></label> : null}
          </> : null}
        </fieldset>
        {edit ? <div className="nz-settings-foot">
          <p className="nz-hint" role="status">{state === 'saved' ? t.saved : state === 'failed' ? t.failed : ''}</p>
          <button type="submit" className="nz-btn nz-btn-rust" data-action="save-settings" disabled={state === 'saving' || (provider !== '' && !modelId.trim())}>{state === 'saving' ? t.saving : t.save}</button>
        </div> : null}
      </form>
      <KnowledgeCard copy={copy} lang={lang} workspaceId={workspaceId} pack={pack} sample={sample} />
    </div>
  </div>;
}
