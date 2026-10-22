'use client';
import { useState } from 'react';
import { fill, type Lang, type Messages } from './copy';
export type ConnectionView = { name: string; host: string; ready: boolean; endpoint?: string; format?: 'openai_chat' | 'simple_json'; header_name?: string | null; key_saved?: boolean; key_last4?: string | null };
export function ExternalAgentCard({ copy, lang, workspaceId, initial, edit, sample, onChange }: { copy: Messages; lang: Lang; workspaceId?: string; initial: ConnectionView | null; edit: boolean; sample: boolean; onChange?: (value: ConnectionView | null) => void }) {
  const t = copy.settings;
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial?.name ?? '');
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? '');
  const [format, setFormat] = useState<'openai_chat' | 'simple_json'>(initial?.format ?? 'openai_chat');
  const [header, setHeader] = useState(initial?.header_name ?? '');
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = name !== (saved?.name ?? '') || endpoint !== (saved?.endpoint ?? '') || format !== (saved?.format ?? 'openai_chat') || header !== (saved?.header_name ?? '') || secret !== '';
  async function act(method: 'PUT' | 'POST' | 'DELETE') {
    if (!workspaceId || !edit || sample || busy) return;
    setBusy(true); setStatus(''); setReply('');
    try {
      const body = method === 'PUT' ? { name, endpoint, format, ...(header ? { header_name: header } : {}), ...(secret ? { secret } : {}) } : method === 'POST' ? { message, language: lang } : undefined;
      const r = await fetch(`/api/workspaces/${workspaceId}/settings/connection`, { method, headers: { 'content-type': 'application/json', 'accept-language': lang }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await r.json();
      if (!r.ok) { setStatus(data.error?.message ?? t.connectionFailed); return; }
      if (method === 'PUT') { setSaved(data); onChange?.(data); setSecret(''); setStatus(t.connectionPending); }
      if (method === 'POST') { const next = saved ? { ...saved, ready: true } : null; setSaved(next); onChange?.(next); setReply(data.reply); setStatus(t.connectionReady); }
      if (method === 'DELETE') { setSaved(null); onChange?.(null); setName(''); setEndpoint(''); setHeader(''); setSecret(''); setFormat('openai_chat'); setStatus(t.connectionRemoved); }
    } catch { setStatus(t.connectionFailed); }
    finally { setBusy(false); }
  }
  return <section className="nz-settings-card" data-card="external-agent">
    <h3>{t.connect}</h3>
    {!edit ? <p>{saved ? fill(t.connectionReadOnly, { name: saved.name, host: saved.host }) : t.connectionEmpty}</p> : <>
      <p className="nz-hint">{t.connectHint}</p>
      <fieldset disabled={busy || sample || !workspaceId}>
        <label>{t.connectionName}<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
        <label>{t.endpoint}<input type="url" dir="ltr" value={endpoint} maxLength={2000} onChange={(e) => setEndpoint(e.target.value)} /></label>
        <label>{t.format}<select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}><option value="openai_chat">{t.formats.openai_chat}</option><option value="simple_json">{t.formats.simple_json}</option></select></label>
        <p className="nz-hint">{t.connectionContract}</p>
        <label>{t.headerName}<input dir="ltr" value={header} maxLength={100} onChange={(e) => setHeader(e.target.value)} /></label>
        <label>{t.connectionKey}<input type="password" autoComplete="off" value={secret} maxLength={400} onChange={(e) => setSecret(e.target.value)} /></label>
        <p className="nz-hint">{t.connectionKeyHint}</p>
        {saved?.key_saved ? <p>{fill(t.keySaved, { last4: `•••• ${saved.key_last4 ?? ''}` })}</p> : null}
        <button type="button" className="nz-btn" data-action="save-connection" disabled={!name.trim() || !endpoint.trim() || !!secret && !header} onClick={() => void act('PUT')}>{t.save}</button>
        <label>{t.testMessage}<textarea value={message} maxLength={1000} rows={2} onChange={(e) => setMessage(e.target.value)} /></label>
        <button type="button" className="nz-btn" data-action="test-connection" disabled={!saved || dirty || !message.trim()} onClick={() => void act('POST')}>{t.sendTest}</button>
        {saved ? <button type="button" className="nz-btn nz-btn-ghost" data-action="remove-connection" onClick={() => void act('DELETE')}>{t.remove}</button> : null}
      </fieldset>
      <p role="status">{busy ? t.connectionBusy : status || (saved ? saved.ready ? t.connectionReady : t.connectionPending : t.connectionEmpty)}</p>
      {reply ? <p data-agent-reply>{reply}</p> : null}
    </>}
  </section>;
}
