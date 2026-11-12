'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import type { ReportBody } from '@/server/reports/build';
import { ChecksView, type ChecksNote } from './checks';
import { checksAccess, checksFromReports, suggestMessage, type CheckRow } from './checks-model';
import { readActiveRuns, kickRun, startQuickCheckOutcome, stopRun } from './checks-run';
import { DocumentLocale } from './document-locale';
import { homeLinks } from './home-model';
import { idOf, readStore, storeKeyFor, titleOf, upsertFix } from './fixes-model';
import { useMemberData } from './member-data';
import { useMemberSnapshot } from './member-snapshot';
import { activeChecksEmpty, initialActiveChecks, receiveActiveChecks } from './checks-active';

type Report = { id: string; created_at: string; body: ReportBody };

/** The signed in checks screen. It reads the same member APIs as the home, and starts and stops runs with the existing endpoints. */
export function ChecksScreen({ workspaceId, initialLang, initialCheck }: { workspaceId: string; initialLang: Lang; initialCheck?: string }) {
  const data = useMemberData(workspaceId, initialLang, true);
  const { lang, phase, reports, roles, assistant, person, setReports } = data;
  const [openId, setOpenId] = useState<string | null>(initialCheck ?? null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const snapshot = useMemberSnapshot(workspaceId);
  const [active, setActive] = useState(() => initialActiveChecks(snapshot?.activeRuns));
  const running = active.runs;
  const [busy, setBusy] = useState<'starting' | 'stopping' | 'suggesting' | null>(null);
  const [note, setNote] = useState<ChecksNote>(null);
  const auto = useRef(false);
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);
  const kicking = useRef(new Map<string, number>());
  const refreshing = useRef<Promise<void> | null>(null);
  const alive = useRef(true);

  const loadReports = useCallback(async () => {
    const response = await fetch(`/api/workspaces/${workspaceId}/reports`, { headers: { 'accept-language': langRef.current } }).catch(() => null);
    if (!response?.ok) return false;
    const body = await response.json().catch(() => null) as { reports?: Report[] } | null;
    if (!alive.current) return true;
    setReports(body?.reports ?? []);
    return true;
  }, [workspaceId, setReports]);

  const refresh = useCallback(async function read(force = false): Promise<void> {
    if (refreshing.current) {
      await refreshing.current;
      if (force) return read();
      return;
    }
    const task = (async () => {
      const reports = loadReports();
      const runs = await readActiveRuns(workspaceId, langRef.current);
      if (!alive.current) return;
      setActive((current) => receiveActiveChecks(current, runs));
      for (const run of runs ?? []) {
        if (Date.now() - (kicking.current.get(run.runId) ?? 0) >= 20_000) {
          kicking.current.set(run.runId, Date.now());
          void kickRun(workspaceId, run.runId);
        }
      }
      await reports;
    })();
    refreshing.current = task;
    try { await task; } finally { refreshing.current = null; }
  }, [workspaceId, loadReports]);

  useEffect(() => {
    alive.current = true;
    if (phase !== 'ready') return () => { alive.current = false; };
    const wanted = new URLSearchParams(window.location.search);
    if (wanted.get('start') === '1') {
      wanted.delete('start');
      window.history.replaceState(null, '', `${window.location.pathname}${wanted.size ? `?${wanted}` : ''}`);
      auto.current = true;
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [phase, refresh]);

  const access = { ...checksAccess(roles), start: data.canStart };
  const copy = messagesFor(lang);
  const checks: CheckRow[] = useMemo(() => checksFromReports(reports, lang, copy), [reports, lang, copy]);

  useEffect(() => {
    if (!auto.current || phase !== 'ready' || active.status !== 'ready' || busy) return;
    auto.current = false;
    if (access.start && activeChecksEmpty(active)) void start();
    // start reads the state of the render it runs in, so only these inputs matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, access.start, active, busy]);

  async function start() {
    if (!access.start || busy || !activeChecksEmpty(active)) return;
    setNote(null);
    setBusy('starting');
    const outcome = await startQuickCheckOutcome(workspaceId, langRef.current);
    setBusy(null);
    if ('fail' in outcome) { setNote(outcome.fail === 'limit' ? 'limit' : outcome.fail === 'unreachable' ? 'unreachable' : 'startFailed'); return; }
    setActive({ runs: [{ runId: outcome.runId, done: 0, total: 8 }], status: 'ready' });
    await refresh(true);
  }

  async function stop(requested?: string) {
    const runId = requested ?? running[0]?.runId;
    if (!runId || !access.stop || busy) return;
    setNote(null);
    setBusy('stopping');
    const ok = await stopRun(workspaceId, runId, langRef.current);
    setBusy(null);
    if (!ok) setNote('stopFailed');
    await refresh(true);
  }

  async function suggest(findingId: string) {
    if (!access.suggest || busy) return;
    setNote(null);
    setBusy('suggesting');
    const response = await fetch(`/api/workspaces/${workspaceId}/agent/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': langRef.current },
      body: JSON.stringify({ message: suggestMessage(findingId, langRef.current) }),
    }).catch(() => null);
    const payload = await response?.json().catch(() => null) as { done?: boolean; data?: unknown } | null;
    setBusy(null);
    const proposalId = response?.ok && payload?.done ? idOf(payload.data) : null;
    if (proposalId) {
      // Kept on this device so the Fixes screen can show the card.
      const name = person?.name ?? copy.shell.omar;
      const list = readStore(localStorage.getItem(storeKeyFor(workspaceId)));
      localStorage.setItem(storeKeyFor(workspaceId), JSON.stringify(upsertFix(list, { id: proposalId, findingId, status: 'waiting', by: { name, initials: person?.initials ?? 'OS', mine: true }, title: titleOf(payload?.data, { en: copy.fixesScreen.fix, ar: copy.fixesScreen.fix }), recheck: null, rerun: false, at: new Date().toISOString() })));
    }
    setNote(response?.ok && payload?.done ? 'suggested' : response?.status === 429 ? 'limit' : 'suggestFailed');
  }

  return <>
    <DocumentLocale lang={lang} />
    <ChecksView
      lang={lang}
      seat={seatFromRoles(roles)}
      phase={phase}
      checks={checks}
      access={access}
      assistant={assistant}
      person={person}
      links={homeLinks(workspaceId)}
      now={new Date()}
      openId={openId}
      openQuestion={openQuestion}
      running={running[0] ?? null}
      active={running}
      activeStatus={active.status}
      busy={busy}
      note={note}
      onOpenCheck={(id) => { setOpenId(id); setOpenQuestion(null); setNote(null); }}
      onBack={() => { setOpenId(null); setNote(null); }}
      onOpenQuestion={(id) => setOpenQuestion((current) => current === id ? '' : id)}
      onStart={() => void start()}
      onStop={(id) => void stop(id)}
      onSuggest={(id) => void suggest(id)}
      onRetry={() => { if (phase === 'ready') void refresh(true); else data.reload(); }}
    />
  </>;
}
