'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import type { ReportBody } from '@/server/reports/build';
import { ChecksView, type ChecksNote } from './checks';
import { checksAccess, checksFromReports, suggestMessage, type CheckRow } from './checks-model';
import { driveRun, startQuickCheck, stopRun, storeKey, type RunProgress } from './checks-run';
import { DocumentLocale } from './document-locale';
import { homeLinks } from './home-model';
import { initialsOf } from './people';

type Membership = { workspaceId: string; workspaceName: string; roles: string[] };
type Report = { id: string; created_at: string; body: ReportBody };

/** The signed in checks screen. It reads the same member APIs as the home, and starts and stops runs with the existing endpoints. */
export function ChecksScreen({ workspaceId, initialLang, initialCheck }: { workspaceId: string; initialLang: Lang; initialCheck?: string }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(initialLang);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reports, setReports] = useState<Report[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [assistant, setAssistant] = useState('');
  const [person, setPerson] = useState<{ initials: string; name: string } | undefined>();
  const [openId, setOpenId] = useState<string | null>(initialCheck ?? null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [running, setRunning] = useState<RunProgress | null>(null);
  const [busy, setBusy] = useState<'starting' | 'stopping' | 'suggesting' | null>(null);
  const [note, setNote] = useState<ChecksNote>(null);
  const [attempt, setAttempt] = useState(0);
  const langRef = useRef(initialLang);
  const stopped = useRef(new Set<string>());
  const driving = useRef<string | null>(null);
  const alive = useRef(true);
  const pinned = useRef(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).has('lang'));

  const loadReports = useCallback(async () => {
    const response = await fetch(`/api/workspaces/${workspaceId}/reports`, { headers: { 'accept-language': langRef.current } }).catch(() => null);
    if (!response?.ok) return false;
    const body = await response.json().catch(() => null) as { reports?: Report[] } | null;
    if (!alive.current) return true;
    setReports(body?.reports ?? []);
    return true;
  }, [workspaceId]);

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
      if (!await loadReports()) { if (!cancelled) setPhase('error'); return; }
      if (cancelled) return;
      const name = typeof meBody?.user?.name === 'string' ? meBody.user.name.trim() : '';
      if (!pinned.current && settings?.language && settings.language !== langRef.current) { langRef.current = settings.language; setLang(settings.language); }
      setRoles(membership.roles);
      setAssistant(settings?.name || membership.workspaceName);
      setPerson(name ? { name: name.split(/\s+/)[0]!, initials: initialsOf(name) } : undefined);
      setPhase('ready');
      // A check started on this page keeps going after the person leaves and comes back.
      const resume = sessionStorage.getItem(storeKey(workspaceId));
      if (resume && checksAccess(membership.roles).start) void track(resume);
    })().catch(() => { if (!cancelled) setPhase('error'); });
    return () => { cancelled = true; alive.current = false; };
  }, [router, workspaceId, loadReports, track, attempt]);

  const access = checksAccess(roles);
  const copy = messagesFor(lang);
  const checks: CheckRow[] = useMemo(() => checksFromReports(reports, lang, copy), [reports, lang, copy]);

  async function start() {
    if (!access.start || busy) return;
    setNote(null);
    setBusy('starting');
    const runId = await startQuickCheck(workspaceId, langRef.current);
    if (!runId) { setBusy(null); setNote('startFailed'); return; }
    setBusy(null);
    void track(runId);
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
    const payload = await response?.json().catch(() => null) as { done?: boolean } | null;
    setBusy(null);
    setNote(response?.ok && payload?.done ? 'suggested' : 'suggestFailed');
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
      onRetry={() => { setPhase('loading'); setAttempt((value) => value + 1); }}
    />
  </>;
}
