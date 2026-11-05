'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import type { ReportBody } from '@/server/reports/build';
import { ChecksView, type ChecksNote } from './checks';
import { checksAccess, checksFromReports, suggestMessage, type CheckRow } from './checks-model';
import { driveRun, startQuickCheckOutcome, stopRun, storeKey, type RunProgress } from './checks-run';
import { DocumentLocale } from './document-locale';
import { homeLinks } from './home-model';
import { idOf, readStore, storeKeyFor, titleOf, upsertFix } from './fixes-model';
import { useMemberData } from './member-data';

type Report = { id: string; created_at: string; body: ReportBody };

/** The signed in checks screen. It reads the same member APIs as the home, and starts and stops runs with the existing endpoints. */
export function ChecksScreen({ workspaceId, initialLang, initialCheck }: { workspaceId: string; initialLang: Lang; initialCheck?: string }) {
  const data = useMemberData(workspaceId, initialLang, true);
  const { lang, phase, reports, roles, assistant, person, setReports } = data;
  const [openId, setOpenId] = useState<string | null>(initialCheck ?? null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [running, setRunning] = useState<RunProgress | null>(null);
  const [busy, setBusy] = useState<'starting' | 'stopping' | 'suggesting' | null>(null);
  const [note, setNote] = useState<ChecksNote>(null);
  const auto = useRef(false);
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);
  const stopped = useRef(new Set<string>());
  const driving = useRef<string | null>(null);
  const alive = useRef(true);

  const loadReports = useCallback(async () => {
    const response = await fetch(`/api/workspaces/${workspaceId}/reports`, { headers: { 'accept-language': langRef.current } }).catch(() => null);
    if (!response?.ok) return false;
    const body = await response.json().catch(() => null) as { reports?: Report[] } | null;
    if (!alive.current) return true;
    setReports(body?.reports ?? []);
    return true;
  }, [workspaceId, setReports]);

  const track = useCallback(async (runId: string) => {
    if (driving.current === runId) return;
    driving.current = runId;
    sessionStorage.setItem(storeKey(workspaceId), runId);
    setRunning((current) => current ?? { runId, done: 0, total: 0 });
    const end = await driveRun(workspaceId, runId, langRef.current, (progress) => { if (alive.current) setRunning(progress); }, () => stopped.current.has(runId));
    driving.current = null;
    sessionStorage.removeItem(storeKey(workspaceId));
    if (!alive.current) return;
    setRunning(null);
    setBusy(null);
    if (end === 'done') {
      await fetch(`/api/workspaces/${workspaceId}/reports`, { method: 'POST', headers: { 'content-type': 'application/json', 'accept-language': langRef.current }, body: JSON.stringify({ run_id: runId }) }).catch(() => null);
      await loadReports();
    } else setNote(end === 'stopped' ? 'stopped' : 'startFailed');
  }, [workspaceId, loadReports]);

  useEffect(() => {
    alive.current = true;
    if (phase !== 'ready') return () => { alive.current = false; };
    // The Start buttons arrive here with start=1: begin once, then drop it from the address so a reload does not start another.
    const wanted = new URLSearchParams(window.location.search);
    if (wanted.get('start') === '1') {
      wanted.delete('start');
      window.history.replaceState(null, '', `${window.location.pathname}${wanted.size ? `?${wanted}` : ''}`);
      if (!sessionStorage.getItem(storeKey(workspaceId))) auto.current = true;
    }
    // A check started on this page keeps going after the person leaves and comes back.
    const resume = sessionStorage.getItem(storeKey(workspaceId));
    if (resume && checksAccess(roles).start) void track(resume);
    return () => { alive.current = false; };
  }, [workspaceId, phase, roles, track]);

  const access = checksAccess(roles);
  const copy = messagesFor(lang);
  const checks: CheckRow[] = useMemo(() => checksFromReports(reports, lang, copy), [reports, lang, copy]);

  useEffect(() => {
    if (!auto.current || phase !== 'ready') return;
    auto.current = false;
    if (access.start && !running && !busy) void start();
    // start reads the state of the render it runs in, so only these inputs matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, access.start]);

  async function start() {
    if (!access.start || busy) return;
    setNote(null);
    setBusy('starting');
    const outcome = await startQuickCheckOutcome(workspaceId, langRef.current);
    setBusy(null);
    if ('fail' in outcome) { setNote(outcome.fail === 'limit' ? 'limit' : outcome.fail === 'unreachable' ? 'unreachable' : 'startFailed'); return; }
    void track(outcome.runId);
  }

  async function stop() {
    const runId = running?.runId;
    if (!runId || !access.stop || busy) return;
    setNote(null);
    setBusy('stopping');
    stopped.current.add(runId);
    const ok = await stopRun(workspaceId, runId, langRef.current);
    if (!ok) { stopped.current.delete(runId); setBusy(null); setNote('stopFailed'); }
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
      running={running}
      busy={busy}
      note={note}
      onOpenCheck={(id) => { setOpenId(id); setOpenQuestion(null); setNote(null); }}
      onBack={() => { setOpenId(null); setNote(null); }}
      onOpenQuestion={(id) => setOpenQuestion((current) => current === id ? '' : id)}
      onStart={() => void start()}
      onStop={() => void stop()}
      onSuggest={(id) => void suggest(id)}
      onRetry={data.reload}
    />
  </>;
}
