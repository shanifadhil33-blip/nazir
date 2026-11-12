'use client';

import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { ExternalView, ConnectionFormat } from '@/server/settings/external-agent';
import { connectHref, connectHomeHref, saveAndTestConnection } from './connect-request';
import { PillButton } from './pill-button';

export function ConnectChoices({ lang, home }: { lang: Lang; home: string }) {
  const c = messagesFor(lang).connect;
  return <div className="nz-connect-choices">
    <section className="nz-connect-choice"><h2>{c.fullTitle}</h2><span className="nz-connect-chip">{c.recommended}</span><p>{c.fullBody}</p><PillButton variant="ink" label={c.fullAction} href={connectHref(home, 'full', lang)} /></section>
    <section className="nz-connect-choice"><h2>{c.quickTitle}</h2><p>{c.quickBody}</p><PillButton label={c.quickAction} href={connectHref(home, 'quick', lang)} /></section>
  </div>;
}

/** Short choices open attached to the field and support arrow keys, Escape and keyboard focus. */
export function AttachedChoice<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false); const id = useId(); const trigger = useRef<HTMLButtonElement>(null);
  return <div className="nz-connect-control" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={(event) => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true);
      const next = (options.findIndex((o) => o.value === value) + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      onChange(options[next]!.value);
    }
  }}><span id={`${id}-label`}>{label}</span>
    <button ref={trigger} type="button" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => setOpen(!open)}><span id={`${id}-value`}>{options.find((o) => o.value === value)?.label}</span><span aria-hidden="true">⌄</span></button>
    {open ? <div className="nz-connect-options" id={id} role="listbox" aria-labelledby={`${id}-label`}>{options.map((o) => <button key={o.value} type="button" role="option" aria-selected={o.value === value} onClick={() => { onChange(o.value); setOpen(false); trigger.current?.focus(); }}>{o.label}</button>)}</div> : null}
  </div>;
}

export function ConnectCard({ workspaceId, lang, mode, connection, home, demo, onSaved }: { workspaceId: string; lang: Lang; mode: 'full' | 'quick'; connection?: ExternalView | null; home: string; demo?: boolean; onSaved?: () => void }) {
  const copy = messagesFor(lang); const c = copy.connect;
  const [format, setFormat] = useState<ConnectionFormat>(connection?.format ?? 'openai_chat');
  const [address, setAddress] = useState(connection?.card_url ?? connection?.endpoint ?? '');
  const [key, setKey] = useState(''); const [keyType, setKeyType] = useState<'api' | 'bearer'>(connection?.header_name === 'Authorization' ? 'bearer' : 'api');
  const [message, setMessage] = useState(c.defaultMessage); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ reply?: string; error?: string; card?: { name: string; skills: unknown[] } } | null>(null);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || demo) return;
    setBusy(true); setResult(null);
    try {
      const result = await saveAndTestConnection(workspaceId, lang, { endpoint: address, format,
        ...(key || connection?.key_saved ? { header_name: keyType === 'bearer' ? 'Authorization' : connection?.header_name && connection.header_name !== 'Authorization' ? connection.header_name : 'X-API-Key' } : {}),
        ...(key ? { secret: keyType === 'bearer' ? `Bearer ${key.replace(/^Bearer /i, '')}` : key } : {}) }, message);
      if (!result.ok) { setResult({ error: connectionError(result.error, copy), card: result.card }); return; }
      setKey(''); setResult({ reply: result.reply, card: result.card });
    } catch { setResult({ error: c.failure }); }
    finally { setBusy(false); onSaved?.(); }
  }
  return <section className="nz-connect-panel" aria-label={mode === 'full' ? c.fullTitle : c.quickTitle}>
    <Link className="nz-connect-back" href={connectHomeHref(home, lang)}>{c.back}</Link>
    <h2>{mode === 'full' ? c.fullTitle : c.quickTitle}</h2>
    {demo ? <p>{c.demoNote}</p> : <>
      {mode === 'full' ? <p>{c.sdkLater}</p> : null}
      <form onSubmit={(e) => void save(e)} className="nz-connect-form">
        <label>{format === 'a2a' ? c.cardAddress : c.address}<input type="url" required maxLength={2000} dir="ltr" autoComplete="url" placeholder="https://example.com/api/chat" value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} /></label>
        {format === 'a2a' ? <p className="nz-connect-hint" dir="auto">{c.cardHint}</p> : null}
        <AttachedChoice label={c.format} value={format} disabled={busy} onChange={setFormat} options={[{ value: 'openai_chat', label: c.openai }, { value: 'simple_json', label: c.simple }, { value: 'a2a', label: c.a2a }]} />
        <p className="nz-connect-hint">{c.formatHint}</p>
        <details><summary>{c.addKey}</summary><p className="nz-connect-hint">{c.keyHint}</p>
          {connection?.key_last4 ? <p><ConnectionLine template={c.savedKey} values={{ last4: { text: connection.key_last4, dir: 'ltr' } }} /></p> : null}
          <AttachedChoice label={c.keyType} value={keyType} disabled={busy} onChange={setKeyType} options={[{ value: 'api', label: c.apiKey }, { value: 'bearer', label: c.bearer }]} />
          <label>{c.keyValue}<input type="password" dir="ltr" autoComplete="new-password" minLength={8} maxLength={400} value={key} onChange={(e) => setKey(e.target.value)} disabled={busy} /></label>
        </details>
        <label>{c.testMessage}<textarea required dir="auto" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} disabled={busy} /></label>
        <PillButton type="submit" variant="ink" label={busy ? c.sending : c.saveTest} disabled={busy} />
      </form>
      <div className="nz-connect-result" aria-live="polite" aria-busy={busy}>
        {result?.card ? <p dir="auto"><ConnectionLine template={c.cardFound} values={{ name: { text: result.card.name, dir: 'auto' }, n: { text: String(result.card.skills.length), dir: 'ltr' } }} /></p> : null}
        {result?.reply ? <><p dir="auto"><ConnectionLine template={c.success} values={{ reply: { text: result.reply, dir: 'auto' } }} /></p><span className="nz-connect-chip">{copy.agentStatus.repliesOnly}</span></> : null}
        {result?.error ? <p role="alert">{result.error}</p> : null}
      </div>
      <p className="nz-connect-hint">{c.testCopyHint}</p>
    </>}
  </section>;
}

function connectionError(body: unknown, copy: ReturnType<typeof messagesFor>): string {
  const error = body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string } }).error : null;
  const keys = { external_needs_input: 'needsInput', external_needs_auth: 'needsAuth', external_unsupported: 'unsupported' } as const;
  const key = keys[error?.code as keyof typeof keys];
  if (key) return copy.connect[key];
  // These errors are localized, fixed server copy, never raw transport messages.
  if (['validation', 'external_timeout', 'external_private_address', 'external_safety', 'external_rate_limit', 'external_changed'].includes(error?.code ?? '') && typeof error?.message === 'string') return error.message;
  return copy.connect.failure;
}

export function AgentStatus({ lang, connection, home }: { lang: Lang; connection?: ExternalView | null; home: string }) {
  const copy = messagesFor(lang); const c = copy.agentStatus;
  if (!connection?.ready) return <section className="nz-agent-status"><h2>{copy.settingsScreen.assistant}</h2><p>{c.none}</p><PillButton label={c.change} href={connectHref(home, 'quick', lang)} /></section>;
  return <section className="nz-agent-status"><h2>{copy.settingsScreen.assistant}</h2>
    <p dir="auto">{connection?.name}</p><p><span className="nz-connect-chip">{c.connected}</span> <span className="nz-connect-chip">{c.repliesOnly}</span></p>
    <p>{c.answers}</p>
    {connection?.tested_at ? <p><ConnectionLine template={c.lastTest} values={{ time: { text: new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(connection.tested_at)), dir: 'ltr' } }} /></p> : null}
    <p>{c.noSdk}</p><div className="nz-agent-actions"><PillButton label={c.addSdk} href={connectHref(home, 'full', lang)} /><PillButton label={c.change} href={connectHref(home, 'quick', lang)} /></div>
  </section>;
}

/** Keep translated punctuation outside untrusted names and replies, and isolate Western counts. */
export function ConnectionLine({ template, values }: { template: string; values: Record<string, { text: string; dir: 'auto' | 'ltr' }> }) {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const value = /^\{\w+\}$/.test(part) ? values[part.slice(1, -1)] : undefined;
    return value ? <bdi key={index} dir={value.dir}>{value.text}</bdi> : part;
  });
}
