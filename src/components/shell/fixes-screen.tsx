'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import type { ReportBody } from '@/server/reports/build';
import { AfterView } from './after';
import { DocumentLocale } from './document-locale';
import { FixesView, type FixAction, type FixesNote } from './fixes';
import {
  cardsFrom, changeBetween, decisionMessage, fixesAccess, patchFix, readStore, recheckCount, recheckMessage, storeKeyFor,
  type StoredFix, type Tab,
} from './fixes-model';
import { homeLinks } from './home-model';
import { initialsOf, personFor } from './people';

type Membership = { workspaceId: string; workspaceName: string; roles: string[] };
type Report = { id: string; created_at: string; body: ReportBody };

/** Loads the member, the saved checks and the fixes kept on this device. One loader for Fixes and for Before and after. */
export function FixesScreen({ workspaceId, initialLang, mode }: { workspaceId: string; initialLang: Lang; mode: 'fixes' | 'after' }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(initialLang);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reports, setReports] = useState<Report[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [assistant, setAssistant] = useState('');
  const [person, setPerson] = useState<{ initials: string; name: string } | undefined>();
  const [stored, setStored] = useState<StoredFix[]>([]);
  const [tab, setTab] = useState<Tab>('waiting');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: FixAction } | null>(null);
  const [note, setNote] = useState<FixesNote>(null);
  const [attempt, setAttempt] = useState(0);
  const langRef = useRef(initialLang);
  // A second tap while one is in flight is ignored here. The server also answers a repeated decision with the saved one.
  const inFlight = useRef(new Set<string>());
  const pinned = useRef(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).has('lang'));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const headers = { 'accept-language': langRef.current };
      const me = await fetch('/api/me', { headers });
      if (cancelled) return;
      if (me.status === 401) { router.replace('/signin'); return; }
      const meBody = await me.json().catch(() => null);
      const membership = (meBody?.memberships as Membership[] | undefined)?.find((item) => item.workspaceId === workspaceId);
      if (!me.ok || !membership) { setPhase('error'); return; }
      const settingsResponse = await fetch(`/api/workspaces/${workspaceId}/settings`, { headers }).catch(() => null);
      const settings = settingsResponse?.ok ? await settingsResponse.json().catch(() => null) as { name?: string; language?: Lang } | null : null;
      const list = await fetch(`/api/workspaces/${workspaceId}/reports`, { headers }).catch(() => null);
      if (!list?.ok) { if (!cancelled) setPhase('error'); return; }
      const body = await list.json().catch(() => null) as { reports?: Report[] } | null;
      if (cancelled) return;
      const name = typeof meBody?.user?.name === 'string' ? meBody.user.name.trim() : '';
      if (!pinned.current && settings?.language && settings.language !== langRef.current) { langRef.current = settings.language; setLang(settings.language); }
      setReports(body?.reports ?? []);
      setRoles(membership.roles);
      setStored(readStore(localStorage.getItem(storeKeyFor(workspaceId))));
      setAssistant(settings?.name || membership.workspaceName);
      setPerson(name ? { name: name.split(/\s+/)[0]!, initials: initialsOf(name) } : undefined);
      setPhase('ready');
    })().catch(() => { if (!cancelled) setPhase('error'); });
    return () => { cancelled = true; };
  }, [router, workspaceId, attempt]);

  const copy = messagesFor(lang);
  const access = fixesAccess(roles);
  const seat = seatFromRoles(roles);
  const canStart = roles.some((role) => role === 'service_owner' || role === 'quality_reviewer');
  const latest = reports[0]?.body ?? null;
  const cards = useMemo(() => cardsFrom(stored, latest, lang, copy, person?.name ?? personFor(seat, copy).name), [stored, latest, lang, copy, person, seat]);
  const change = reports.length >= 2 ? changeBetween(reports[1]!.body, reports[0]!.body) : null;
  const links = homeLinks(workspaceId);

  function save(next: StoredFix[]) {
    setStored(next);
    localStorage.setItem(storeKeyFor(workspaceId), JSON.stringify(next));
  }

  async function chat(message: string) {
    const response = await fetch(`/api/workspaces/${workspaceId}/agent/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': langRef.current },
      body: JSON.stringify({ message }),
    }).catch(() => null);
    const payload = await response?.json().catch(() => null) as { done?: boolean; data?: unknown } | null;
    return { ok: Boolean(response?.ok && payload?.done), data: payload?.data };
  }

  async function act(id: string, action: FixAction) {
    const allowed = action === 'recheck' ? access.recheck : access.decide;
    if (!allowed || inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setNote(null);
    setBusy({ id, action });
    const message = action === 'recheck' ? recheckMessage(id, langRef.current) : decisionMessage(id, action, langRef.current);
    const result = await chat(message);
    inFlight.current.delete(id);
    setBusy(null);
    const current = readStore(localStorage.getItem(storeKeyFor(workspaceId)));
    if (!result.ok) { setNote(action === 'recheck' ? 'rerunFailed' : 'failed'); return; }
    if (action === 'approve') { save(patchFix(current, id, { status: 'approved', recheck: recheckCount(result.data) })); setNote('approvedNote'); }
    else if (action === 'reject') { save(patchFix(current, id, { status: 'turnedDown' })); setNote('turnedNote'); }
    else { save(patchFix(current, id, { rerun: true })); setNote('rerunStarted'); }
  }

  return <>
    <DocumentLocale lang={lang} />
    {mode === 'after'
      ? <AfterView lang={lang} seat={seat} phase={phase} change={change} canStart={canStart} assistant={assistant} person={person} links={links} onRetry={() => { setPhase('loading'); setAttempt((value) => value + 1); }} />
      : <FixesView
        lang={lang} seat={seat} phase={phase} fixes={cards} access={access} canStart={canStart} assistant={assistant} person={person} links={links}
        tab={tab} openId={openId} busy={busy} note={note}
        onTab={(next) => { setTab(next); setNote(null); }}
        onToggle={(id) => setOpenId((current) => current === id ? '' : id)}
        onAction={(id, action) => void act(id, action)}
        onRetry={() => { setPhase('loading'); setAttempt((value) => value + 1); }}
      />}
  </>;
}
