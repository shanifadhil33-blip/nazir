'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import { AfterView } from './after';
import { DocumentLocale } from './document-locale';
import { FixesView, type FixAction, type FixesNote } from './fixes';
import {
  cardsFrom, measuredChange, decisionMessage, fixesAccess, mergeServerFixes, patchFix, readStore, recheckCount, recheckMessage, storeKeyFor,
  type StoredFix, type Tab,
} from './fixes-model';
import { homeLinks } from './home-model';
import { personFor } from './people';
import { useMemberData } from './member-data';

/** Loads the member, the saved checks and the fixes kept on this device. One loader for Fixes and for Before and after. */
export function FixesScreen({ workspaceId, initialLang, mode }: { workspaceId: string; initialLang: Lang; mode: 'fixes' | 'after' }) {
  const data = useMemberData(workspaceId, initialLang, true, true);
  const { lang, phase, reports, roles, assistant, person } = data;
  const [stored, setStored] = useState<StoredFix[]>(() => mergeServerFixes([], data.fixes));
  const [tab, setTab] = useState<Tab>('waiting');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: FixAction } | null>(null);
  const [note, setNote] = useState<FixesNote>(null);
  // A second tap while one is in flight is ignored here. The server also answers a repeated decision with the saved one.
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    // Device-only fixes are read after hydration; initial HTML uses server fixes.
    if (phase === 'ready') Promise.resolve().then(() => {
      if (!cancelled) setStored(mergeServerFixes(readStore(localStorage.getItem(storeKeyFor(workspaceId))), data.fixes));
    });
    return () => { cancelled = true; };
  }, [workspaceId, phase, data.fixes]);

  const copy = messagesFor(lang);
  const access = fixesAccess(roles);
  const seat = seatFromRoles(roles);
  const canStart = roles.some((role) => role === 'service_owner' || role === 'quality_reviewer');
  const cards = useMemo(() => cardsFrom(stored, reports.map((row) => row.body), lang, copy, person?.name ?? personFor(seat, copy).name), [stored, reports, lang, copy, person, seat]);
  const change = reports.length >= 2 ? measuredChange(reports[1]!.body, reports[0]!.body) : null;
  const links = homeLinks(workspaceId);

  function save(next: StoredFix[]) {
    setStored(next);
    localStorage.setItem(storeKeyFor(workspaceId), JSON.stringify(next));
  }

  async function chat(message: string) {
    const response = await fetch(`/api/workspaces/${workspaceId}/agent/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': lang },
      body: JSON.stringify({ message }),
    }).catch(() => null);
    const payload = await response?.json().catch(() => null) as { done?: boolean; data?: unknown } | null;
    return { ok: Boolean(response?.ok && payload?.done), data: payload?.data };
  }

  function decidedNow(status: 'approved' | 'turnedDown') {
    const me = person ?? personFor(seat, copy);
    return { at: new Date().toISOString(), name: me.name, initials: me.initials, status };
  }

  async function act(id: string, action: FixAction) {
    const allowed = action === 'recheck' ? access.recheck : access.decide;
    if (!allowed || inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setNote(null);
    setBusy({ id, action });
    const message = action === 'recheck' ? recheckMessage(id, lang) : decisionMessage(id, action, lang);
    const result = await chat(message);
    inFlight.current.delete(id);
    setBusy(null);
    const current = readStore(localStorage.getItem(storeKeyFor(workspaceId)));
    if (!result.ok) { setNote(action === 'recheck' ? 'rerunFailed' : 'failed'); return; }
    if (action === 'approve') { save(patchFix(current, id, { status: 'approved', recheck: recheckCount(result.data), decided: decidedNow('approved') })); setNote('approvedNote'); }
    else if (action === 'reject') { save(patchFix(current, id, { status: 'turnedDown', decided: decidedNow('turnedDown') })); setNote('turnedNote'); }
    else { save(patchFix(current, id, { rerun: true })); setNote('rerunStarted'); }
  }

  return <>
    <DocumentLocale lang={lang} />
    {mode === 'after'
      ? <AfterView lang={lang} seat={seat} phase={phase} change={change} canStart={canStart} assistant={assistant} person={person} links={links} onRetry={data.reload} />
      : <FixesView
        lang={lang} seat={seat} phase={phase} fixes={cards} access={access} canStart={canStart} assistant={assistant} person={person} links={links}
        tab={tab} openId={openId} busy={busy} note={note}
        onTab={(next) => { setTab(next); setNote(null); }}
        onToggle={(id) => setOpenId((current) => current === id ? '' : id)}
        onAction={(id, action) => void act(id, action)}
        onRetry={data.reload}
      />}
  </>;
}
