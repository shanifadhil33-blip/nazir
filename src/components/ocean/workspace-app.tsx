'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fill, messagesFor, type Lang, type Messages } from './copy';
import { canApprove, canCancel, canRunRecheck, emptyModel, firstStepFor, modelFromReports, rolesForSeat, sampleModel, seatFromRoles, type CancelTarget, type LogEvent, type ScreenId, type ScreenModel, type Seat, type Status } from './model';
import type { ReportBody } from '@/server/reports/build';
import { WorkspaceScreen } from './screen';
import type { Measured } from './screen';
import { LiveTestPanel } from './live-test';
import { driveSteps } from './step-loop';
import { AgentSettingsPanel, defaultSettings, type PackView, type SettingsView } from './agent-settings';

/** runs is null when the count is not known, for example on a single report page. */
type Bundle = { latest: ReportBody; previous: ReportBody | null; agentName: string; sample: boolean; runs?: number | null } | 'sample';

type Membership = {
  workspaceId: string;
  workspaceName: string;
  kind: 'real' | 'demo';
  roles: string[];
  roleLabels: { en: string[]; ar: string[] };
};

export function WorkspaceApp({
  workspaceId, preview = false, initialLang = 'en', initialRole = 'owner', initialScreen = 'chat', initialSettingsOpen = false, reportId, shared = false,
}: {
  workspaceId: string;
  preview?: boolean;
  initialLang?: Lang;
  initialRole?: Seat;
  initialScreen?: ScreenId;
  initialSettingsOpen?: boolean;
  reportId?: string;
  shared?: boolean;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [screen, setScreen] = useState<ScreenId>(initialScreen);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'signedout' | 'denied'>(preview ? 'ready' : 'loading');
  const [demo, setDemo] = useState(preview);
  const [seat, setSeat] = useState<Seat>(preview ? initialRole : 'viewer');
  const [roles, setRoles] = useState<string[]>(preview ? rolesForSeat(initialRole) : []);
  const [userName, setUserName] = useState(preview ? messagesFor(initialLang).sample.user : '');
  const [bundle, setBundle] = useState<Bundle | null>(preview ? 'sample' : null);
  const [extra, setExtra] = useState<LogEvent[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [runStarted, setRunStarted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(initialSettingsOpen);
  const [packs, setPacks] = useState<PackView[] | null>(null);
  const thread = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stopped = useRef(new Set<string>());
  const langRef = useRef(lang);

  const copy = messagesFor(lang);
  const model = useMemo(() => deriveModel(bundle, copy, lang, preview), [bundle, copy, lang, preview]);

  useEffect(() => {
    langRef.current = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    if (preview) return;
    let cancel = false;
    async function load() {
      const current = messagesFor(langRef.current);
      const meResponse = await fetch('/api/me', { headers: { 'accept-language': langRef.current } });
      const meBody = await meResponse.json().catch(() => null);
      if (cancel) return;
      if (meResponse.status === 401) { setPhase('signedout'); return; }
      if (!meResponse.ok) { setNotice(readError(meBody, current)); setPhase('denied'); return; }
      const membership = (meBody.memberships as Membership[] | undefined)?.find((item) => item.workspaceId === workspaceId);
      if (!membership) { setNotice(current.ui.notYours); setPhase('denied'); return; }
      const nextSeat = seatFromRoles(membership.roles);
      const nextDemo = membership.kind === 'demo';
      const nextName = meBody.user?.name || meBody.user?.email || membership.workspaceName;
      setSeat(nextSeat);
      setRoles(membership.roles);
      setDemo(nextDemo);
      setUserName(nextName);
      const headers = { 'accept-language': langRef.current };
      const settingsResponse = await fetch(`/api/workspaces/${workspaceId}/settings`, { headers }).catch(() => null);
      void fetch(`/api/workspaces/${workspaceId}/packs`, { headers }).then((r) => r.ok ? r.json() : null).then((p) => { if (!cancel && p && Array.isArray(p.packs)) setPacks(p.packs as PackView[]); }).catch(() => undefined);
      void fetch(`/api/workspaces/${workspaceId}/results`, { headers }).then((r) => r.ok ? r.json() : null).then((m) => { if (!cancel && m && Array.isArray(m.metrics)) setMeasured(m as Measured); }).catch(() => undefined);
      const settingsBody = settingsResponse?.ok ? await settingsResponse.json().catch(() => null) as SettingsView | null : null;
      if (cancel) return;
      if (settingsBody) {
        setSettings(settingsBody);
        if (!new URLSearchParams(window.location.search).has('lang') && settingsBody.language !== langRef.current) setLang(settingsBody.language);
      }
      if (reportId) {
        const reportResponse = await fetch(`/api/workspaces/${workspaceId}/reports/${reportId}`, { headers });
        const reportBody = await reportResponse.json().catch(() => null);
        if (cancel) return;
        if (!reportResponse.ok) { setNotice(readError(reportBody, current)); setPhase('denied'); return; }
        setBundle({ latest: reportBody as ReportBody, previous: null, agentName: membership.workspaceName, sample: nextDemo });
        setPhase('ready');
        return;
      }
      const listResponse = await fetch(`/api/workspaces/${workspaceId}/reports`, { headers });
      const listBody = await listResponse.json().catch(() => null);
      if (cancel) return;
      if (!listResponse.ok) { setNotice(readError(listBody, current)); setPhase('denied'); return; }
      const reports = (listBody.reports ?? []) as { body: ReportBody }[];
      const runs = typeof listBody.runs === 'number' ? listBody.runs : null;
      if (reports[0]?.body) {
        setBundle({ latest: reports[0].body, previous: reports[1]?.body ?? null, agentName: membership.workspaceName, sample: nextDemo, runs });
      } else if (nextDemo) setBundle('sample');
      else setBundle({ latest: emptyBody(), previous: null, agentName: membership.workspaceName, sample: false, runs });
      setPhase('ready');
    }
    load().catch(() => { if (!cancel) { setNotice(messagesFor(langRef.current).ui.nothingChanged); setPhase('denied'); } });
    return () => { cancel = true; };
  }, [preview, workspaceId, reportId]);

  function go(next: ScreenId) {
    const apply = () => setScreen(next);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const desktop = window.matchMedia('(min-width: 1280px)').matches;
    if (!reduce && !desktop && typeof document.startViewTransition === 'function') document.startViewTransition(apply);
    else apply();
  }

  function push(event: LogEvent) {
    setExtra((items) => [...items, event]);
  }

  async function send(message: string, display?: string) {
    push({ id: crypto.randomUUID(), kind: 'user', title: '', body: display ?? message });
    if (preview) {
      push({ id: crypto.randomUUID(), kind: 'note', title: copy.ui.note, body: copy.ui.previewHint });
      return;
    }
    const approving = message.startsWith('I approve repair') || message.startsWith('أوافق على الإصلاح');
    if (approving) push({ id: 'applying', kind: 'note', title: copy.ui.applying, body: '' });
    setPending(true);
    setStatus('running');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/agent/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept-language': lang },
        body: JSON.stringify({ message, ...(thread.current ? { thread_id: thread.current } : {}) }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      setExtra((items) => items.filter((item) => item.id !== 'applying'));
      if (!response.ok) {
        push({ id: crypto.randomUUID(), kind: 'error', title: copy.ui.errorTitle, body: readError(payload, copy) });
        return;
      }
      if (typeof payload?.thread_id === 'string') thread.current = payload.thread_id;
      const reply = lang === 'ar' ? payload?.reply?.ar : payload?.reply?.en;
      const text = typeof reply === 'string' ? reply : copy.ui.nothingChanged;
      const done = payload?.done === true;
      const planId = done && payload?.tool === 'propose_plan' ? idOf(payload?.data) : null;
      if (done && payload?.tool === 'decide_repair') push({ id: crypto.randomUUID(), kind: 'applied', title: copy.ui.fixApplied, body: text });
      else if (done && payload?.tool === 'rerun_tests') push({ id: crypto.randomUUID(), kind: 'recheck', title: copy.ui.recheck, body: text });
      else push({ id: crypto.randomUUID(), kind: 'note', title: copy.ui.reply, body: text, ...(planId ? { cancel: { kind: 'plan' as const, id: planId } } : {}) });
      if (done && (payload?.tool === 'start_run' || payload?.tool === 'rerun_tests')) { setRunStarted(true); void drive(runIdsIn(payload?.data)); }
    } catch {
      setExtra((items) => items.filter((item) => item.id !== 'applying'));
      if (controller.signal.aborted) push({ id: crypto.randomUUID(), kind: 'note', title: copy.ui.note, body: copy.ui.stopped });
      else push({ id: crypto.randomUUID(), kind: 'error', title: copy.ui.errorTitle, body: copy.ui.nothingChanged });
    } finally {
      setPending(false);
      setStatus(null);
    }
  }

  // Runs queued from chat are driven one conversation per request, only while this page is open.
  // A step that dies (time limit, dropped database) is retried after a pause; the server retries a stalled test once and then ends it, so the run still finishes.
  // Steps are spaced out and paused while the tab is hidden (see step-loop.ts), so an open tab does not keep the server busy.
  async function drive(runIds: string[]) {
    const clear = () => setExtra((items) => items.filter((item) => item.id !== 'drive-progress'));
    const show = (runId: string, body: string) => setExtra((items) => [...items.filter((item) => item.id !== 'drive-progress'), { id: 'drive-progress', kind: 'note', title: copy.ui.note, body, cancel: { kind: 'run', id: runId } }]);
    const stopWith = (body: string) => { clear(); setStatus(null); push({ id: crypto.randomUUID(), kind: 'note', title: copy.ui.note, body }); };
    for (const runId of runIds.slice(0, 4)) {
      let last = -1, halt = false, lastError: { status?: number; payload: unknown } = { payload: null };
      const end = await driveSteps(async () => {
        if (stopped.current.has(runId)) return 'stop';
        const response = await fetch(`/api/workspaces/${workspaceId}/runs/${runId}/step`, { method: 'POST', headers: { 'accept-language': lang } }).catch(() => null);
        if (stopped.current.has(runId)) return 'stop';
        if (!response?.ok) {
          const payload = await response?.json().catch(() => null);
          lastError = { status: response?.status, payload };
          if (response?.status !== 503 && (!response || response.status >= 500)) { show(runId, copy.ui.runRetrying); return 'error'; }
          halt = true; stopWith(response?.status === 503 ? copy.ui.runWaiting : readError(payload, copy)); return 'stop';
        }
        const p = await response.json().catch(() => null) as { done: boolean; passed: number; failed: number; inconclusive: number; waiting: number; notes?: { en: string; ar: string }[] } | null;
        if (!p) { halt = true; return 'stop'; }
        const finished = p.passed + p.failed + p.inconclusive;
        const notes = (p.notes ?? []).map((note) => note[lang] || note.en).join(' ');
        if (p.done || p.waiting === 0) { setStatus(null); clear(); push({ id: crypto.randomUUID(), kind: 'recheck', title: copy.ui.recheck, body: [fill(copy.ui.runDone, { passed: String(p.passed), failed: String(p.failed), inconclusive: String(p.inconclusive) }), notes].filter(Boolean).join(' ') }); return 'done'; }
        setStatus('running'); show(runId, [fill(copy.ui.runProgress, { done: String(finished), total: String(finished + p.waiting) }), notes].filter(Boolean).join(' '));
        // Nothing moved: a retry is waiting, a step ran out of its time budget, or a stalled step's lease has not run out yet.
        if (finished === last) return 'idle';
        last = finished;
        return 'progress';
      });
      if (halt) return;
      if (end === 'errors') { stopWith(lastError.status === 503 ? copy.ui.runWaiting : readError(lastError.payload, copy)); return; }
    }
  }

  async function cancelTarget(target: CancelTarget) {
    if (preview || !canCancel(roles, shared)) return;
    if (target.kind === 'run') stopped.current.add(target.id);
    const response = await fetch(`/api/workspaces/${workspaceId}/${target.kind === 'plan' ? 'plans' : 'runs'}/${target.id}/cancel`, { method: 'POST', headers: { 'accept-language': lang } }).catch(() => null);
    const payload = await response?.json().catch(() => null) as { runs?: string[] } | null;
    if (!response?.ok) {
      if (target.kind === 'run') stopped.current.delete(target.id);
      push({ id: crypto.randomUUID(), kind: 'error', title: copy.ui.errorTitle, body: readError(payload, copy) });
      return;
    }
    for (const id of payload?.runs ?? []) stopped.current.add(id);
    const ended = new Set([target.id, ...(payload?.runs ?? [])]);
    setExtra((items) => items.filter((item) => !(item.id === 'drive-progress' && item.cancel && ended.has(item.cancel.id))).map((item) => item.cancel && ended.has(item.cancel.id) ? { ...item, cancel: undefined } : item));
    if (target.kind === 'run' || payload?.runs?.length) setStatus(null);
    push({ id: crypto.randomUUID(), kind: 'note', title: copy.ui.note, body: target.kind === 'plan' ? copy.ui.planCancelled : copy.ui.runCancelled });
  }

  function approve(id?: string) {
    if (!canApprove(roles, shared)) return;
    if (!id) { push({ id: crypto.randomUUID(), kind: 'note', title: copy.ui.note, body: copy.ui.nothingChanged }); return; }
    const message = lang === 'ar'
      ? `أوافق على الإصلاح ${id} لأنني راجعت الإجابة المتوقعة والإجابة الفعلية في عرض الخطأ. اطلعت على الدليل.`
      : `I approve repair ${id} because I reviewed the expected and actual answers in the failure view. I opened the evidence.`;
    void send(message, copy.ui.approve);
  }

  function skip(id?: string) {
    if (!canApprove(roles, shared)) return;
    if (!id) { push({ id: crypto.randomUUID(), kind: 'note', title: copy.ui.note, body: copy.ui.nothingChanged }); return; }
    const message = lang === 'ar'
      ? `أرفض الإصلاح ${id} لأنني راجعت الإجابة المتوقعة والإجابة الفعلية ولا أوافق على التغيير الآن. اطلعت على الدليل.`
      : `I reject repair ${id} because I reviewed the expected and actual answers and do not accept this change yet. I opened the evidence.`;
    void send(message, copy.ui.skip);
  }

  function recheck() {
    if (!canRunRecheck(roles, shared)) return;
    const proposalId = model.failures.find((item) => item.proposalId)?.proposalId;
    const message = lang === 'ar'
      ? `أعد الاختبارات المتأثرة${proposalId ? ` ${proposalId}` : ''}`
      : `rerun the affected tests${proposalId ? ` ${proposalId}` : ''}`;
    void send(message, copy.ui.runRecheck);
  }

  async function share() {
    const path = reportId ? `/w/${workspaceId}/report/${reportId}` : `/w/${workspaceId}/report`;
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  if (phase !== 'ready') {
    return <div className="nz-app" lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <main className="nz-legal">
        <h1>{copy.name}</h1>
        <p>{phase === 'loading' ? copy.ui.loading : notice || copy.ui.notYours}</p>
        {phase === 'signedout' ? <p><Link href="/api/auth/signin">{copy.signIn}</Link></p> : null}
        <nav aria-label="Legal"><Link href="/privacy">{copy.privacy}</Link><Link href="/terms">{copy.terms}</Link></nav>
      </main>
    </div>;
  }

  const packNames = copy.settings.packNames as Record<string, string>;
  const firstStep = firstStepFor({
    runs: bundle && bundle !== 'sample' ? bundle.runs ?? null : null, demo, preview, shared,
    agent: settings?.name || copy.ui.sampleAgent, pack: packNames[settings?.focus_pack ?? 'government'] ?? packNames.government!,
  });
  const view: ScreenModel = { ...model, agentName: settings?.name || model.agentName, status: status ?? model.status, events: [...model.events, ...extra], firstStep: runStarted ? null : firstStep };
  const shown: SettingsView = settings ?? { ...defaultSettings(view.agentName), can_edit: preview && seat === 'owner' };

  async function saveSettings(body: unknown): Promise<SettingsView | null> {
    if (preview) { const next = { ...shown, ...(body as Partial<SettingsView>), llm: shown.llm, can_edit: shown.can_edit }; setSettings(next); return next; }
    const response = await fetch(`/api/workspaces/${workspaceId}/settings`, { method: 'PUT', headers: { 'content-type': 'application/json', 'accept-language': lang }, body: JSON.stringify(body) }).catch(() => null);
    if (!response?.ok) throw await response?.json().catch(() => null);
    const next = await response.json().catch(() => null) as SettingsView | null;
    if (next) { setSettings(next); if (next.language !== lang) setLang(next.language); }
    return next;
  }

  return <><WorkspaceScreen
    lang={lang} copy={copy} demo={demo} seat={seat} roles={roles} shared={shared} userName={userName} model={view} screen={screen}
    pending={pending} copied={copied} copyError={copyError} onScreen={go} onLang={setLang} onApprove={approve} onSkip={skip}
    onReplay={(size = 'full') => void send(size === 'quick' ? (lang === 'ar' ? 'فحص سريع' : 'run a quick check') : (lang === 'ar' ? 'اقترح خطة للمجموعة الكاملة' : 'propose a plan for the full suite'), size === 'quick' ? copy.ui.quickCheck : copy.ui.fullSuite)}
    pdfHref={!preview && reportId && roles.some((role) => role === 'service_owner' || role === 'quality_reviewer') ? `/api/workspaces/${workspaceId}/reports/${reportId}/pdf?lang=${lang}` : undefined}
    onShare={() => void share()} onSend={(message) => void send(message)} onStop={() => abortRef.current?.abort()}
    onRecheck={recheck} onCancel={(target) => void cancelTarget(target)} measured={preview ? null : measured} onLiveTest={() => setLiveOpen(true)} avatar={shown.avatar} onSettings={() => setSettingsOpen(true)}
  />{settingsOpen ? <AgentSettingsPanel copy={copy} lang={lang} settings={shown} sample={preview} workspaceId={preview ? undefined : workspaceId} packs={packs ?? undefined} onClose={() => setSettingsOpen(false)} onConnectionChange={(value) => setSettings((current) => current ? { ...current, external_agent: value } : { ...shown, external_agent: value })} onSave={saveSettings} /> : null}{liveOpen ? <LiveTestPanel key={lang} copy={copy} lang={lang} workspaceId={workspaceId} sample={preview} reportHref={`/w/${workspaceId}/report`} onClose={() => setLiveOpen(false)} /> : null}</>;
}

function deriveModel(bundle: Bundle | null, copy: Messages, lang: Lang, preview: boolean): ScreenModel {
  if (preview || bundle === 'sample') return sampleModel(copy);
  // A saved report of a run with no conversations is still a report; only a workspace with none gets the first report message.
  if (bundle && bundle.latest.counts.conversations === 0 && bundle.latest.findings.length === 0 && !bundle.sample) return { ...emptyModel(copy, bundle.agentName), empty: !bundle.latest.run.id };
  if (bundle) return modelFromReports(bundle.latest, bundle.previous, copy, lang, bundle.agentName, bundle.sample);
  return emptyModel(copy, copy.name);
}

function emptyBody(): ReportBody {
  return {
    scope: { en: '', ar: '' },
    run: { id: '', status: '', calls_used: 0, calls_budget: 0 },
    counts: { conversations: 0, passed: 0, failed: 0, inconclusive: 0, findings: 0 },
    conversations: [], findings: [], messages: [], hidden_findings: 0, sentences: { en: [], ar: [] },
  };
}

function readError(payload: unknown, copy: Messages) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const message = (payload as { error?: { message?: unknown } }).error?.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return copy.ui.nothingChanged;
}

function idOf(data: unknown): string | null {
  const id = data && typeof data === 'object' ? (data as { id?: unknown }).id : null;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function runIdsIn(data: unknown): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, key = '') => {
    if (typeof value === 'string' && key === 'run_id' && /^[0-9a-f-]{36}$/i.test(value)) found.add(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, key === 'runs' ? 'run' : key));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k === 'id' && key === 'run' ? 'run_id' : k);
  };
  walk(data);
  return [...found];
}
