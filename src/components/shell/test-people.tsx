'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { TestPeopleView } from '@/server/safety/test-people';
import { PillButton } from './pill-button';

/** Staging logins stay in this form only until saved. Reads never return them. */
export function TestPeopleSetup({ workspaceId, revision, lang, initialOpen = false }: { workspaceId: string; revision: string; lang: Lang; initialOpen?: boolean }) {
  const text = messagesFor(lang).testPeople;
  const [people, setPeople] = useState<TestPeopleView | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<'saved' | 'removed' | 'failed' | 'changed' | null>(null);
  const [removing, setRemoving] = useState(false);
  const reading = useRef(false);
  const endpoint = `/api/workspaces/${workspaceId}/settings/test-people`;
  const load = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const response = await fetch(endpoint, { headers: { 'accept-language': lang }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('read_failed');
      const body = await response.json() as { people: TestPeopleView | null };
      if (!Object.hasOwn(body, 'people')) throw new Error('invalid_reply');
      setPeople(body.people); setPhase('ready');
    } catch { setPhase('error'); }
    finally { reading.current = false; }
  }, [endpoint, lang]);
  useEffect(() => { if (initialOpen) { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); } }, [initialOpen, load]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget), field = (name: string) => String(form.get(name) ?? '');
    setBusy(true); setNote(null);
    const response = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json', 'accept-language': lang }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ revision, header: field('header'), a: { name: field('a-name'), reference: field('a-reference'), token: field('a-token') }, b: { name: field('b-name'), reference: field('b-reference'), token: field('b-token') } }) }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setNote(response?.status === 409 ? 'changed' : 'failed'); return; }
    const body = await response.json().catch(() => null) as { people?: TestPeopleView } | null;
    if (!body?.people) { setNote('failed'); return; }
    setPeople(body.people); setNote('saved');
  }
  async function remove() {
    if (busy) return; setBusy(true); setNote(null);
    const response = await fetch(endpoint, { method: 'DELETE', headers: { 'accept-language': lang }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    setBusy(false); setRemoving(false);
    if (!response?.ok) { setNote('failed'); return; }
    setPeople(null); setNote('removed');
  }
  return <details className="nz-test-people" open={initialOpen || undefined} onToggle={(event) => { if (event.currentTarget.open && phase !== 'ready') void load(); }}>
    <summary>{text.title}{people ? <span>{text.configured}</span> : null}</summary>
    <div className="nz-test-people-body">
      <p>{text.intro}</p>
      {phase === 'loading' ? <p role="status">{text.loading}</p> : phase === 'error' ? <p role="alert">{text.failed} <button type="button" className="nz-quiet-btn" onClick={() => void load()}>{text.retry}</button></p> : <>
        {note ? <p className="nz-note-line" role="status">{text[note]}{note === 'changed' ? <button type="button" className="nz-quiet-btn" onClick={() => window.location.reload()}>{text.reload}</button> : null}</p> : null}
        <form key={people?.id ?? 'new'} className="nz-test-people-form" onSubmit={(event) => void save(event)}>
          <label>{text.header}<input name="header" autoComplete="off" required maxLength={100} defaultValue={people?.header ?? 'Authorization'} dir="ltr" /></label>
          <p className="nz-check-sub">{text.headerNote}</p>
          {(['a', 'b'] as const).map((person) => <fieldset key={person}>
            <legend>{person === 'a' ? text.personA : text.personB}</legend>
            <label>{text.name}<input name={`${person}-name`} autoComplete="off" required maxLength={60} defaultValue={people?.[person].name ?? ''} placeholder={person === 'a' ? text.exampleA : text.exampleB} /></label>
            <label>{text.reference}<input name={`${person}-reference`} autoComplete="off" required maxLength={100} defaultValue={people?.[person].reference ?? ''} dir="auto" /></label>
            <label>{text.token}<input name={`${person}-token`} type="password" autoComplete="new-password" required minLength={8} maxLength={2000} /></label>
          </fieldset>)}
          <p className="nz-check-sub">{text.private}</p>
          {people ? <p className="nz-check-sub">{text.replace}</p> : null}
          <div className="nz-agent-actions"><PillButton type="submit" variant="ink" label={busy ? text.saving : text.save} disabled={busy} />{people ? <PillButton label={text.remove} disabled={busy} onClick={() => setRemoving(true)} /> : null}</div>
        </form>
        {removing ? <div className="nz-test-people-remove"><p>{text.removeSure}</p><div className="nz-agent-actions"><PillButton label={text.remove} disabled={busy} onClick={() => void remove()} /><PillButton label={text.cancel} disabled={busy} onClick={() => setRemoving(false)} /></div></div> : null}
      </>}
    </div>
  </details>;
}
