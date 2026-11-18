'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Heading } from '@/components/heading';
import { fill, messagesFor, type Lang } from '@/components/ocean/copy';
import type { SafetyDetail, SafetySummary, Weakness } from '@/server/safety/read';
import { mappingMeaning } from '@/server/safety/attacks';
import { dayLabel } from './checks-model';
import { ShellIcon } from './icons';
import { PillButton } from './pill-button';
import { PhaseCard, StateCard } from './state-card';

type List = { runs: SafetySummary[]; confirmed: boolean; demo: boolean; agent: boolean; proof?: { url: string; token: string } | null; nextAt?: string | null };
export type SafetyNote = 'limit' | 'failed' | 'fixApproved' | 'proof' | 'sdk' | null;

/** Safety tab data: the list, one open test, and the actions. Polls only while a test runs. */
export function useSafety(workspaceId: string, lang: Lang, enabled: boolean, initialOpen?: string) {
  const [list, setList] = useState<List | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [openId, setOpenId] = useState<string | null>(initialOpen ?? null);
  const [detail, setDetail] = useState<SafetyDetail | null>(null);
  const [busy, setBusy] = useState<'starting' | 'stopping' | 'fixing' | null>(null);
  const [note, setNote] = useState<SafetyNote>(null);
  const langRef = useRef(lang);
  const openRef = useRef(openId);
  useEffect(() => { openRef.current = openId; }, [openId]);
  useEffect(() => { langRef.current = lang; }, [lang]);
  const headers = useCallback(() => ({ 'content-type': 'application/json', 'accept-language': langRef.current }), []);

  const load = useCallback(async () => {
    const response = await fetch(`/api/workspaces/${workspaceId}/safety`, { headers: headers() }).catch(() => null);
    if (!response?.ok) { setPhase((p) => (p === 'ready' ? p : 'error')); return null; }
    const body = await response.json() as List;
    setList(body); setPhase('ready');
    return body;
  }, [workspaceId, headers]);
  const loadDetail = useCallback(async (id: string) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/safety/${id}`, { headers: headers() }).catch(() => null);
    if (response?.ok) setDetail(await response.json() as SafetyDetail);
  }, [workspaceId, headers]);

  // The first read waits a tick so it never runs inside the render that turned the tab on.
  useEffect(() => { if (!enabled) return; const t = setTimeout(() => { void load(); if (openRef.current) void loadDetail(openRef.current); }, 0); return () => clearTimeout(t); }, [enabled, load, loadDetail]);
  // One wake-up at quota expiry; no idle polling while nothing is running.
  useEffect(() => {
    if (!enabled || !list?.nextAt) return;
    const wait = Date.parse(list.nextAt) - Date.now();
    if (!Number.isFinite(wait) || wait <= 0) return;
    const timer = setTimeout(() => { void load(); }, wait + 100);
    return () => clearTimeout(timer);
  }, [enabled, list?.nextAt, load]);
  const active = list?.runs.find((r) => r.status === 'queued' || r.status === 'running') ?? null;
  useEffect(() => {
    if (!enabled || !active) return;
    const timer = setInterval(() => { void load().then((body) => { if (openId && body) void loadDetail(openId); }); }, 4000);
    return () => clearInterval(timer);
  }, [enabled, active, load, loadDetail, openId]);
  const openTest = useCallback((id: string | null) => { setOpenId(id); if (id) void loadDetail(id); }, [loadDetail]);

  async function post(path: string, body: unknown) {
    const response = await fetch(`/api/workspaces/${workspaceId}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) }).catch(() => null);
    return response;
  }
  async function start(confirm: boolean) {
    if (busy) return;
    setBusy('starting'); setNote(null);
    if (confirm) {
      const ok = await post('/safety', { action: 'confirm' });
      if (!ok?.ok) { setBusy(null); const body = await ok?.json().catch(() => null); setNote(body?.error?.code === 'safety_proof_needed' ? 'proof' : 'failed'); await load(); return; }
    }
    const response = await post('/safety', { action: 'start' });
    setBusy(null);
    if (!response?.ok) { const body = await response?.json().catch(() => null); setNote(response?.status === 429 ? 'limit' : body?.error?.code === 'safety_sdk_update' ? 'sdk' : 'failed'); await load(); return; }
    const { id } = await response.json() as { id: string };
    setOpenId(null);
    await load();
    return id;
  }
  async function stop(id: string) {
    if (busy) return;
    setBusy('stopping'); setNote(null);
    const response = await post(`/safety/${id}`, {});
    setBusy(null);
    if (!response?.ok) setNote('failed');
    await load();
  }
  async function approve(family: string) {
    if (busy) return;
    setBusy('fixing'); setNote(null);
    const response = await post('/safety/fix', { family });
    setBusy(null);
    setNote(response?.ok ? 'fixApproved' : 'failed');
    if (openId) await loadDetail(openId);
  }
  return { list, phase, openId, setOpenId: openTest, detail, busy, note, active, start, stop, approve, reload: load };
}

type Props = { lang: Lang; now: Date; safety: ReturnType<typeof useSafety>; canStart: boolean; reportHref: (id: string) => string; settingsHref: string; /** Opens or closes one test, through the address. */ onOpen?: (id: string | null) => void };

/** The Safety tab body: running card, confirm, list of tests, and one test's verdict and weaknesses. */
export function SafetyBody({ lang, now, safety, canStart, reportHref, settingsHref, onOpen }: Props) {
  const [permission, setPermission] = useState(false);
  const open_ = onOpen ?? safety.setOpenId;
  const copy = messagesFor(lang);
  const text = copy.safetyScreen;
  const { list, phase, busy, note, active } = safety;
  if (phase !== 'ready' || !list) return <div className="nz-checks-body"><div className="nz-checks-list"><PhaseCard phase={phase === 'error' ? 'error' : 'loading'} copy={copy} onRetry={() => void safety.reload()} /></div></div>;
  const needConfirm = !list.demo && !list.confirmed;
  const open = safety.detail && safety.detail.id === safety.openId ? safety.detail : null;
  const limited = Boolean(list.nextAt && new Date(list.nextAt).getTime() > now.getTime());
  const availableAt = list.nextAt ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(list.nextAt)) : '';
  const sdkUrl = new URL(settingsHref, 'https://nazir.invalid'); sdkUrl.searchParams.delete('screen'); sdkUrl.searchParams.set('connect', 'full'); sdkUrl.searchParams.set('lang', lang);
  const startLabel = busy === 'starting' ? text.starting : needConfirm ? text.confirmStart : text.testSafety;
  return (
    <div className="nz-checks-body">
      <div className="nz-checks-list">
        {note ? <p className="nz-note-line" role="status" data-note={note}>{note === 'sdk' ? <a className="nz-back" href={sdkUrl.pathname + sdkUrl.search}>{text.sdkUpdate}</a> : note === 'limit' ? text.limit : note === 'fixApproved' ? text.fixApproved : note === 'proof' ? text.proofFailed : text.failed}</p> : null}
        {limited && !active ? <p className="nz-note-line" role="status">{fill(text.availableAt, { time: availableAt })}</p> : null}
        {active ? <SafetyRunning lang={lang} run={active} stopping={busy === 'stopping'} onStop={() => void safety.stop(active.id)} /> : null}
        {!list.agent ? <StateCard kind="empty" title={text.needAgent} action={{ label: copy.connect.title, href: settingsHref }} /> : null}
        {list.agent && !active && needConfirm && canStart ? (
          <section className="nz-safety-confirm" aria-label={text.confirmTitle}>
            <h2>{text.confirmTitle}</h2>
            {list.proof ? <div className="nz-safety-proof">
              <p>{text.proofLine}</p>
              <a href={list.proof.url} target="_blank" rel="noreferrer" dir="ltr">{list.proof.url}</a>
              <label>{text.proofContent}<textarea readOnly dir="ltr" rows={2} value={list.proof.token} onFocus={(event) => event.currentTarget.select()} /></label>
              <p className="nz-check-sub">{text.proofPublic}</p>
            </div> : null}
            <label className="nz-safety-permission"><input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} /> <strong>{text.confirmLine}</strong></label>
            <p className="nz-check-sub">{text.confirmNote}</p>
            <PillButton variant="ink" icon="play" directional className="nz-safety-start" label={startLabel} disabled={busy === 'starting' || !permission || limited} onClick={() => void safety.start(true)} />
          </section>
        ) : null}
        {list.agent && list.runs.length === 0 && !needConfirm ? <StateCard kind="empty" title={text.empty} action={canStart && !limited ? { label: startLabel, onClick: busy === 'starting' ? undefined : () => void safety.start(false) } : null} /> : null}
        {list.runs.map((run) => (
          <button key={run.id} type="button" className="nz-check-card nz-safety-card" data-verdict={run.verdict ?? run.status} aria-pressed={safety.openId === run.id} onClick={() => open_(run.id)}>
            <span className={run.verdict === 'ready_safe' || run.verdict === 'replies_clean' ? 'nz-check-mark nz-check-mark-right' : 'nz-check-mark nz-check-mark-wrong'}><ShellIcon name={run.verdict === 'ready_safe' || run.verdict === 'replies_clean' ? 'check' : 'dot'} /></span>
            <span className="nz-check-text">
              <strong>{fill(text.rowTitle, { day: dayLabel(new Date(run.at), now, lang, copy) })}</strong>
              <small className={run.verdict === 'ready_safe' || run.verdict === 'replies_clean' ? 'nz-check-right' : 'nz-check-wrong'}>{rowLine(run, lang)}</small>
            </span>
            <span className="nz-check-go"><ShellIcon name="play" directional /></span>
          </button>
        ))}
        {list.agent && list.runs.length > 0 && !active && !needConfirm && canStart ? <PillButton className="nz-checks-start nz-safety-start" icon="play" directional label={startLabel} disabled={busy === 'starting' || limited} onClick={() => void safety.start(false)} /> : null}
      </div>
      {safety.openId ? (open ? <SafetyDetailView lang={lang} now={now} run={open} demo={list.demo} busy={busy} canStart={canStart && !active && !limited && !needConfirm} onBack={() => open_(null)} onApprove={(f) => void safety.approve(f)} onAgain={() => void safety.start(false)} reportHref={reportHref(open.id)} settingsHref={settingsHref} />
        : <section className="nz-check-page"><PhaseCard phase="loading" copy={copy} /></section>) : null}
    </div>
  );
}

function rowLine(run: SafetySummary, lang: Lang) {
  const text = messagesFor(lang).safetyScreen;
  if (run.status === 'queued' || run.status === 'running') return fill(text.running, { done: String(run.done), total: String(run.total) });
  if (run.status === 'paused') return text.paused;
  if (run.status === 'stopped') return fill(text.stopped, { done: String(run.done), total: String(run.total) });
  return run.verdict ? text.verdict[run.verdict] : '';
}

function SafetyRunning({ lang, run, stopping, onStop }: { lang: Lang; run: SafetySummary; stopping: boolean; onStop: () => void }) {
  const text = messagesFor(lang).safetyScreen;
  const line = fill(text.running, { done: String(run.done), total: String(run.total) });
  const percent = run.total ? Math.round((run.done / run.total) * 100) : 0;
  return (
    <section className="nz-running" aria-label={line} data-running="true" data-safety="true">
      <div className="nz-running-top">
        <p className="nz-running-title"><span className="nz-live-dot" aria-hidden="true" /><strong>{line}</strong></p>
        <button type="button" className="nz-quiet-btn" disabled={stopping} onClick={onStop}>{stopping ? text.stopping : text.stop}</button>
      </div>
      <div className="nz-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={line}><span style={{ inlineSize: `${percent}%` }} /></div>
    </section>
  );
}

function SafetyDetailView({ lang, now, run, demo, busy, canStart, onBack, onApprove, onAgain, reportHref, settingsHref }: {
  lang: Lang; now: Date; run: SafetyDetail; demo: boolean; busy: string | null; canStart: boolean;
  onBack: () => void; onApprove: (family: string) => void; onAgain: () => void; reportHref: string; settingsHref: string;
}) {
  const copy = messagesFor(lang);
  const text = copy.safetyScreen;
  const [openFamily, setOpenFamily] = useState<string | null>(null);
  const found = run.weaknesses.filter((w) => w.outcome === 'broken' || w.outcome === 'partial');
  const other = run.weaknesses.filter((w) => w.outcome !== 'broken' && w.outcome !== 'partial');
  const firstOpen = openFamily ?? found[0]?.family ?? null;
  const finished = run.status === 'done';
  return (
    <section className="nz-check-page nz-safety-page" aria-label={fill(text.rowTitle, { day: dayLabel(new Date(run.at), now, lang, copy) })}>
      <button type="button" className="nz-back" onClick={onBack}><ShellIcon name="play" directional /><span>{text.back}</span></button>
      <Heading as="h2" light={fill(text.rowTitle, { day: dayLabel(new Date(run.at), now, lang, copy) })} bold={finished && run.verdict ? text.verdict[run.verdict] : rowLine(run, lang)} lang={lang} flow="stack" />
      {run.scope === 'replies_only' ? <p className="nz-check-sub" data-scope="replies_only">{text.repliesOnly}</p> : null}
      {run.scope === 'sample' ? <p className="nz-check-sub">{text.sampleLine}</p> : null}
      {finished ? <>
        <h3 className="nz-safety-sub">{text.weaknesses}</h3>
        {found.length === 0 ? <p className="nz-check-sub">{text.noWeakness}</p> : null}
        <ul className="nz-questions">
          {found.map((w) => <WeaknessRow key={w.family} lang={lang} weakness={w} open={firstOpen === w.family} demo={demo} busy={busy} canStart={canStart} onToggle={() => setOpenFamily(firstOpen === w.family ? '' : w.family)} onApprove={() => onApprove(w.family)} onAgain={onAgain} />)}
        </ul>
        {other.length ? <ul className="nz-safety-other">{other.map((w) => <li key={w.family} data-outcome={w.outcome}><strong>{w.title[lang]}</strong><span>{w.reason === 'test_people' || w.reason === 'test_people_control' ? <a href={`${settingsHref}&setup=people`}>{text.reason[w.reason]}</a> : w.reason ? text.reason[w.reason] : text.outcome[w.outcome]}</span></li>)}</ul> : null}
        {run.resisted.length ? <p className="nz-check-sub nz-safety-held">{fill(text.heldUp, { n: String(run.resisted.length) })}</p> : null}
        <div className="nz-safety-actions">
          <PillButton icon="pencil" label={text.report} href={reportHref} />
          {canStart ? <PillButton variant="ink" icon="play" directional className="nz-safety-again" label={busy === 'starting' ? text.starting : demo ? text.testAgain : text.changedTestAgain} disabled={busy === 'starting'} onClick={onAgain} /> : null}
        </div>
      </> : null}
    </section>
  );
}

function WeaknessRow({ lang, weakness: w, open, demo, busy, canStart, onToggle, onApprove, onAgain }: {
  lang: Lang; weakness: Weakness; open: boolean; demo: boolean; busy: string | null; canStart: boolean; onToggle: () => void; onApprove: () => void; onAgain: () => void;
}) {
  const text = messagesFor(lang).safetyScreen;
  const where = w.languages.length === 2 ? text.inBoth : w.languages[0] === 'ar' ? text.inArabic : text.inEnglish;
  return (
    <li className="nz-question nz-weakness" data-severity={w.severity ?? 'none'} data-open={open} data-family={w.family}>
      <button type="button" className="nz-question-head" aria-expanded={open} onClick={onToggle}>
        <span className="nz-question-text">{w.title[lang]}</span>
        <span className={`nz-mark nz-sev nz-sev-${w.severity ?? 'low'}`}>{w.severity ? text.severity[w.severity] : text.outcome[w.outcome]}</span>
      </button>
      {open ? <div className="nz-question-body">
        <p className="nz-safety-chips">{w.proven ? <span className="nz-mark nz-mark-unsure" data-proven={w.proven}>{text.proven[w.proven]}</span> : null}<span className="nz-mark nz-mark-unsure">{where}</span></p>
        <div className="nz-quote nz-quote-plain"><p className="nz-quote-label">{text.tried}</p><p>{w.tried[lang]}</p></div>
        {w.reply ? <div className="nz-quote nz-quote-said"><p className="nz-quote-label">{text.replyLabel}</p><p dir="auto">{w.reply}</p></div> : null}
        {w.did ? <div className="nz-quote nz-quote-record"><p className="nz-quote-label">{text.didLabel}</p><p dir="auto">{w.did}</p>{w.note === 'would_have_happened' ? <p>{text.wouldHave}</p> : null}</div> : null}
        <div className="nz-quote nz-quote-plain"><p className="nz-quote-label">{text.fix}</p><p>{w.fix[lang]}</p></div>
        <div className="nz-safety-map"><p className="nz-quote-label">{text.mapping}</p>
          <p className="nz-safety-chips">{w.mapping.map((m) => <span key={m} className="nz-mark nz-mark-unsure" title={mappingMeaning[m]?.[lang] ?? m} tabIndex={0}>{m}</span>)}</p>
        </div>
        {demo ? (w.fixed
          ? (canStart ? <PillButton variant="ink" icon="play" directional label={busy === 'starting' ? text.starting : text.testAgain} disabled={busy === 'starting'} onClick={onAgain} /> : <p className="nz-check-sub">{text.fixApproved}</p>)
          : <PillButton variant="ink" icon="check" className="nz-safety-approve" label={busy === 'fixing' ? text.starting : text.approveFix} disabled={busy === 'fixing'} onClick={onApprove} />) : null}
      </div> : null}
    </li>
  );
}
