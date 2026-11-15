'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import { AfterView } from './after';
import { DocumentLocale } from './document-locale';
import { FixesView, type FixAction, type FixesNote } from './fixes';
import { fixCards, fixesAccess, type Tab } from './fixes-model';
import { homeLinks } from './home-model';
import { useMemberData } from './member-data';

/** One loader for Fixes and for Before and after. Every fix and its test again progress come from the server. */
export function FixesScreen({ workspaceId, initialLang, mode, fixId }: { workspaceId: string; initialLang: Lang; mode: 'fixes' | 'after'; fixId?: string | null }) {
  const data = useMemberData(workspaceId, initialLang, true, true);
  const { lang, phase, reports, roles, assistant, person } = data;
  const [tab, setTab] = useState<Tab>('waiting');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: FixAction } | null>(null);
  const [note, setNote] = useState<FixesNote>(null);
  // A second tap while one is in flight is ignored here. The server also answers a repeated action with the saved one.
  const inFlight = useRef(new Set<string>());

  const copy = messagesFor(lang);
  const access = fixesAccess(roles);
  const seat = seatFromRoles(roles);
  const cards = useMemo(() => fixCards(data.fixes, reports, lang, copy), [data.fixes, reports, lang, copy]);
  const testing = cards.some((card) => card.retest.state === 'running');
  const links = homeLinks(workspaceId);
  const { reload } = data;

  // While a fix is being tested, read the server every 5 s so the card moves on its own. Paused when the tab is hidden.
  useEffect(() => {
    if (!testing) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 5000);
    return () => clearInterval(timer);
  }, [testing, reload]);

  async function copyChange(id: string) {
    const card = cards.find((item) => item.id === id);
    if (!card) return;
    try {
      await navigator.clipboard.writeText(card.fix);
      setBusy({ id, action: 'copy' }); setNote('copied');
      setTimeout(() => setBusy((current) => current?.action === 'copy' ? null : current), 1500);
    } catch { setNote('copyFailed'); }
  }

  async function act(id: string, action: FixAction) {
    if (action === 'copy') { await copyChange(id); return; }
    const allowed = action === 'retest' ? access.recheck : access.decide;
    if (!allowed || inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setNote(null);
    setBusy({ id, action });
    const response = await fetch(`/api/workspaces/${workspaceId}/proposals/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'accept-language': lang }, body: JSON.stringify({ action }),
    }).catch(() => null);
    const payload = await response?.json().catch(() => null) as { error?: { code?: string } } | null;
    inFlight.current.delete(id);
    if (!response?.ok) {
      setBusy(null);
      setNote(payload?.error?.code === 'run_active' ? 'runActive' : 'failed');
      return;
    }
    // Refetch first, then let go of the button, so the card moves once and the list never empties.
    await reload();
    setBusy(null);
    setTab('done');
    setNote(action === 'reject' ? 'skippedNote' : 'testStarted');
  }

  return <>
    <DocumentLocale lang={lang} />
    {mode === 'after'
      ? <AfterView lang={lang} seat={seat} phase={phase} fixId={fixId ?? null} fixes={data.fixes} reports={reports} canStart={data.canStart} assistant={assistant} person={person} links={links} onRetry={reload} />
      : <FixesView
        lang={lang} seat={seat} phase={phase} fixes={cards} access={access} canStart={data.canStart} assistant={assistant} person={person} links={links}
        tab={tab} openId={openId} busy={busy} note={note}
        onTab={(next) => { setTab(next); setNote(null); }}
        onToggle={(id) => setOpenId((current) => current === id ? '' : id)}
        onAction={(id, action) => void act(id, action)}
        onRetry={reload}
      />}
  </>;
}
