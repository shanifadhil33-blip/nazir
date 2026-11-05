'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { fill, type Lang, type Messages } from './copy';
import { AgentAvatar } from './agent-settings';
import { canApprove, canCancel, canCompose, canRunQuickCheck, canRunRecheck, dubaiStamp, type CancelTarget, type FailureCase, type Metrics, type ScreenId, type ScreenModel, type Seat } from './model';
import { ScoreFigure } from './score-figure';

const bars = ['safety', 'accuracy', 'rules', 'recovery'] as const;

function Icon({ name }: { name: typeof bars[number] | 'send' | 'link' | 'chat' | 'score' | 'fail' | 'report' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'safety') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M12 3 5 6v6c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6l-7-3z" /></svg>;
  if (name === 'accuracy') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="12" cy="12" r="8" /><path {...common} d="m8.5 12.5 2.2 2.2 4.8-5.2" /></svg>;
  if (name === 'rules') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M8 4h9a2 2 0 0 1 2 2v14H8a2 2 0 0 0-2 2V6a2 2 0 0 1 2-2zM8 8h7M8 12h7" /></svg>;
  if (name === 'recovery') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 12a8 8 0 1 0 2.2-5.5M4 4v5h5" /></svg>;
  if (name === 'send') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M5 12h14M13 6l6 6-6 6" /></svg>;
  if (name === 'link') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2" /><path {...common} d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2" /></svg>;
  if (name === 'chat') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M5 16.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3z" /></svg>;
  if (name === 'score') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="12" cy="12" r="8" /><path {...common} d="M12 8v4l2.5 2" /></svg>;
  if (name === 'fail') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M12 4 3 19h18L12 4zM12 10v4M12 16.5v.5" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M7 3h8l5 5v13H7zM15 3v5h5M9 13h7M9 17h5" /></svg>;
}

function statusLabel(copy: Messages, status: ScreenModel['status']) {
  if (status === 'waiting') return copy.ui.waiting;
  if (status === 'running') return copy.ui.running;
  return copy.ui.idle;
}

function Counters({ copy, metrics }: { copy: Messages; metrics: Metrics }) {
  const items = [
    ['pass', metrics.pass, 'is-teal'],
    ['fail', metrics.fail, 'is-rust'],
    ['critical', metrics.critical, 'is-rust'],
  ] as const;
  return <div className="nz-counters">{items.map(([key, value, tone]) => <p key={key} className={tone}><span>{copy.ui[key]}</span><strong>{value}</strong></p>)}</div>;
}

function Bars({ copy, metrics, lang }: { copy: Messages; metrics: Metrics; lang: Lang }) {
  return <ul className="nz-bars">{bars.map((key) => {
    const value = metrics[key];
    return <li key={key} className="nz-bar">
      <span className="nz-bar-name"><Icon name={key} />{copy.ui[key]}</span>
      <span className="nz-bar-value">{value}</span>
      <span className="nz-bar-track"><span className={value >= 80 ? 'nz-bar-fill' : 'nz-bar-fill is-weak'} data-origin={lang === 'ar' ? 'right' : 'left'} style={{ ['--p' as string]: value / 100 }} /></span>
    </li>;
  })}</ul>;
}

function RecordDetail({ copy, lines }: { copy: Messages; lines: { text: string; lang?: 'en' | 'ar' }[] }) {
  if (!lines.length) return null;
  return <details className="nz-raw">
    <summary>{copy.ui.recordDetail}</summary>
    {lines.map((line, index) => <p key={`${line.lang ?? 'raw'}-${index}`} lang={line.lang} dir={line.lang === 'ar' ? 'rtl' : line.lang === 'en' ? 'ltr' : 'auto'}>{line.text}</p>)}
  </details>;
}

function FailureBody({ copy, item, decide, pending, onApprove, onSkip, onEdit }: {
  copy: Messages; item: FailureCase; decide: boolean; pending: boolean;
  onApprove: (id?: string) => void; onSkip: (id?: string) => void; onEdit: () => void;
}) {
  // Approve, edit and skip need a real proposal to act on; without one we say so plainly.
  const proposed = Boolean(item.proposalId);
  const raw = [
    item.rawEn ? { text: item.rawEn, lang: 'en' as const } : null,
    item.rawAr ? { text: item.rawAr, lang: 'ar' as const } : null,
    item.rawQuote ? { text: item.rawQuote } : null,
  ].filter((line): line is { text: string; lang?: 'en' | 'ar' } => line !== null);
  return <div className="nz-cross">
    {item.outcome ? <p>{item.outcome} {item.flaky ? <span className="nz-chip">{copy.ui.flaky}</span> : null}</p> : null}
    <div className="nz-case-line"><div><p className="nz-case">{item.caseLabel}</p><h3>{copy.ui.openFailure}</h3></div><span className="nz-chip">{copy.ui.critical}</span></div>
    <p className="nz-kicker">{copy.ui.expectedVersus}</p>
    <div className="nz-versus">
      <article className="nz-expect"><h4>{copy.ui.expected}</h4><p lang="en" dir="ltr">{item.expectedEn}</p><p lang="ar" dir="rtl">{item.expectedAr}</p></article>
      <p className="nz-versus-word">{copy.ui.versus}</p>
      <article className="nz-actual"><h4>{copy.ui.actual}</h4><p lang="en" dir="ltr">{item.actualEn}</p><p lang="ar" dir="rtl">{item.actualAr}</p></article>
    </div>
    <div className="nz-split">
      <section><h4>{copy.ui.diagnosis}</h4><p>{item.diagnosis}</p></section>
      <section><h4>{copy.ui.proposedFix}</h4><p>{item.proposed || copy.ui.noRepair}</p></section>
    </div>
    <RecordDetail copy={copy} lines={raw} />
    {!proposed ? <p className="nz-note" data-note="no-fix">{copy.ui.noFixToApprove}</p> : decide ? <div className="nz-actions">
      <button type="button" className="nz-btn nz-btn-rust" data-action="approve" disabled={pending} onClick={() => onApprove(item.proposalId)}>{pending ? <span className="nz-spin" /> : copy.ui.approve}</button>
      <button type="button" className="nz-btn nz-btn-ghost" data-action="edit" onClick={onEdit}>{copy.ui.editFix}</button>
      <button type="button" className="nz-btn nz-btn-ghost" data-action="skip" onClick={() => onSkip(item.proposalId)}>{copy.ui.skip}</button>
    </div> : <p className="nz-note" data-note="reviewer">{copy.ui.reviewerDecides}</p>}
  </div>;
}

const sections = [['chat', 'chat'], ['score', 'score'], ['failures', 'fail'], ['report', 'report']] as const;

export function WorkspaceScreen({
  lang, copy, demo, seat, roles, shared = false, userName, model, screen, pending = false, copied = false, copyError = false,
  onScreen, onLang, onApprove, onSkip, onReplay, onShare, onSend, onStop, onRecheck, avatar = 'preset:1', onSettings, measured = null, onLiveTest, pdfHref, onCancel,
}: {
  lang: Lang; copy: Messages; demo: boolean; seat: Seat; roles: readonly string[]; shared?: boolean; userName: string; model: ScreenModel; screen: ScreenId;
  pending?: boolean; copied?: boolean; copyError?: boolean;
  onScreen: (screen: ScreenId) => void; onLang: (lang: Lang) => void; onApprove: (id?: string) => void; onSkip: (id?: string) => void;
  onReplay: (size?: 'quick' | 'full') => void; onShare: () => void; onSend: (message: string, display?: string) => void; onStop: () => void; onRecheck: () => void;
  pdfHref?: string;
  avatar?: string; onSettings?: () => void; measured?: Measured | null; onLiveTest?: () => void; onCancel?: (target: CancelTarget) => void;
}) {
  const [tab, setTab] = useState(0);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const decide = canApprove(roles, shared);
  const recheck = canRunRecheck(roles, shared);
  const cancellable = canCancel(roles, shared) && Boolean(onCancel);
  const recheckReady = model.failures.some((item) => Boolean(item.proposalId));
  const compose = canCompose(seat, shared);
  const quick = canRunQuickCheck(roles, shared);
  const active = model.failures[Math.min(tab, Math.max(0, model.failures.length - 1))];
  const labelFor = (item: FailureCase) => lang === 'ar' ? item.tabAr : item.tab;
  let step = 0;

  function edit() {
    setDraft(copy.ui.editPrompt);
  }

  function open(id: ScreenId) {
    onScreen(id);
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 1280px)').matches) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => {
      document.getElementById(`nz-${id}`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
    });
  }

  return <div className="nz-app" lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} data-demo={demo ? 'true' : 'false'} data-seat={seat}>
    <header className="nz-header">
      <button type="button" className="nz-brand" data-action="agent-settings" aria-label={copy.settings.open} onClick={onSettings}>
        <AgentAvatar value={avatar} size={40} />
        <div><p className="nz-title">{copy.name}</p><p className="nz-sub">{copy.ui.subtitle}</p></div>
      </button>
      <nav className="nz-desk-nav" aria-label={copy.ui.sections}>
        {sections.map(([id, icon]) => <button type="button" key={id} aria-current={screen === id ? 'page' : undefined} onClick={() => open(id)}><Icon name={icon} />{copy.ui[id === 'failures' ? 'failures' : id]}</button>)}
      </nav>
      <div className="nz-header-actions">
        {demo ? <span className="nz-pill">{copy.ui.sampleData}</span> : null}
        {demo && onLiveTest ? <button type="button" className="nz-btn nz-btn-teal" data-action="open-live" onClick={onLiveTest}>{copy.live.open}</button> : null}
        <div className="nz-lang" role="group" aria-label={copy.ui.english}>
          <button type="button" aria-pressed={lang === 'en'} onClick={() => onLang('en')}>EN</button>
          <span aria-hidden="true">|</span>
          <button type="button" aria-pressed={lang === 'ar'} onClick={() => onLang('ar')}>عربي</button>
        </div>
        <div className="nz-menu">
          {seat === 'viewer' ? <span className="nz-viewer">{copy.ui.viewer}</span> : null}
          <button type="button" className="nz-btn nz-btn-ghost nz-user" aria-expanded={menu} aria-haspopup="menu" aria-label={copy.ui.menu} onClick={() => setMenu((open) => !open)}>{userName}</button>
          {menu ? <div className="nz-menu-pop" role="menu">
            <Link role="menuitem" href="/w">{copy.shell.home}</Link>
            <Link role="menuitem" href="/api/auth/signout">{copy.ui.signOut}</Link>
            <Link role="menuitem" href="/privacy">{copy.privacy}</Link>
            <Link role="menuitem" href="/terms">{copy.terms}</Link>
          </div> : null}
        </div>
      </div>
    </header>
    <div className="nz-columns" data-screen={screen}>
      <section className="nz-panel nz-log" id="nz-chat" aria-label={copy.ui.agentLog}>
        <div className="nz-panel-head">
          <div><h2>{copy.ui.agentLog}</h2><p className="nz-status"><span className={`nz-dot nz-dot-${model.status}`} />{statusLabel(copy, model.status)}</p></div>
          {compose ? <span className="nz-actions"><button type="button" className="nz-btn nz-btn-ghost" data-action="quick" disabled={pending} onClick={() => onReplay('quick')}>{copy.ui.quickCheck}</button><button type="button" className="nz-btn nz-btn-ghost" data-action="replay" disabled={pending} onClick={() => onReplay('full')}>{copy.ui.fullSuite}</button></span> : null}
        </div>
        <button type="button" className="nz-compact" onClick={() => open('score')}>
          <span>{model.agentName}</span>
          <ScoreFigure value={model.metrics.score} compact />
          <span className="nz-compact-counts">{copy.ui.pass} {model.metrics.pass} · {copy.ui.fail} {model.metrics.fail} · {copy.ui.critical} {model.metrics.critical}</span>
        </button>
        <div className="nz-scroll">
          {model.firstStep ? <div className="nz-card nz-card-suite" data-state="first-step">
            <div>
              <strong>{copy.ui.firstStepTitle}</strong>
              <p>{fill(copy.ui.firstStepBody, { agent: model.firstStep.agent, pack: model.firstStep.pack })}</p>
              <p>{copy.ui.firstStepQuick}</p>
              {quick ? <div className="nz-actions"><button type="button" className="nz-btn nz-btn-teal" data-action="first-quick" disabled={pending} onClick={() => onReplay('quick')}>{copy.ui.firstStepAction}</button></div> : <p className="nz-note" data-note="first-step-viewer">{copy.ui.firstStepViewer}</p>}
            </div>
          </div> : null}
          <ol className="nz-timeline">
            {model.events.map((event) => {
              const number = event.kind === 'user' ? null : ++step;
              return <li key={event.id} className={`nz-card nz-card-${event.kind} nz-enter`} style={{ ['--i' as string]: step }}>
                {number !== null ? <span className={event.kind === 'critical' ? 'nz-num-bubble is-critical' : 'nz-num-bubble'}>{number}</span> : null}
                <div>
                  {event.title ? <strong>{event.title}</strong> : null}
                  <p dir={event.kind === 'user' ? 'auto' : undefined}>{event.body}</p>
                  {event.detail ? <RecordDetail copy={copy} lines={[{ text: event.detail }]} /> : null}
                  {event.kind === 'fix' ? <div className="nz-actions">
                    <button type="button" className="nz-btn nz-btn-rust" data-action="open-failure" onClick={() => open('failures')}>{copy.ui.openFailure}</button>
                  </div> : null}
                  {event.kind === 'recheck' ? <button type="button" className="nz-btn nz-btn-ghost" onClick={() => open('report')}>{copy.ui.report}</button> : null}
                  {event.cancel && cancellable ? <div className="nz-actions"><button type="button" className="nz-btn nz-btn-ghost" data-action={`cancel-${event.cancel.kind}`} onClick={() => onCancel!(event.cancel!)}>{event.cancel.kind === 'plan' ? copy.ui.cancelPlan : copy.ui.cancelRun}</button></div> : null}
                </div>
              </li>;
            })}
          </ol>
          {model.events.length === 0 && !model.firstStep ? <p className="nz-empty">{copy.ui.noReport}</p> : null}
        </div>
        {compose ? <form className="nz-composer" onSubmit={(event) => { event.preventDefault(); if (!pending && draft.trim().length >= 2) { onSend(draft.trim()); setDraft(''); } }}>
          <button type="button" className="nz-icon-btn" data-action="attach" aria-label={copy.ui.attach}><Icon name="link" /></button>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={copy.ui.composer} aria-label={copy.ui.composer} />
          {pending ? <button type="button" className="nz-send" aria-label={copy.ui.stop} onClick={onStop}><span className="nz-spin" /></button> : <button type="submit" className="nz-send" aria-label={copy.ui.send}><Icon name="send" /></button>}
        </form> : <p className="nz-note">{copy.ui.viewerNote}</p>}
      </section>
      <div className="nz-side">
        <section className="nz-panel nz-score-panel" id="nz-score" aria-label={copy.ui.score}>
          <div className="nz-score-top">
            <div>
              <button type="button" className="nz-agent nz-agent-btn" data-action="agent-card" aria-label={copy.settings.open} onClick={onSettings}><AgentAvatar value={avatar} size={28} />{model.agentName}</button>
              <ScoreFigure value={model.metrics.score} named={screen !== 'report'} caption={copy.ui.outOf} />
            </div>
          </div>
          <Counters copy={copy} metrics={model.metrics} />
          {model.outcomes?.map((c) => <p key={c.id}>{c.label} {c.flaky ? <span className="nz-chip">{copy.ui.flaky}</span> : null}</p>)}
          <Bars copy={copy} metrics={model.metrics} lang={lang} />
          <button type="button" className="nz-btn nz-btn-ghost" onClick={() => open('report')}>{copy.ui.report}</button>
        </section>
        <section className="nz-panel nz-failure" id="nz-failures" aria-label={copy.ui.failures}
          style={drag ? { transform: `translateY(${drag}px)` } : undefined}
          onPointerDown={(event) => { if (window.innerWidth >= 1280 || !(event.target as HTMLElement).closest('.nz-sheet-handle')) return; dragStart.current = event.clientY; }}
          onPointerMove={(event) => { if (dragStart.current === null) return; setDrag(Math.max(0, event.clientY - dragStart.current)); }}
          onPointerUp={() => { if (drag > 80) onScreen('chat'); dragStart.current = null; setDrag(0); }}>
          <button type="button" className="nz-sheet-handle nz-only-phone" aria-label={copy.ui.close} onClick={() => onScreen('chat')} />
          {model.failures.length > 0 && active ? <>
            <div className="nz-seg" role="tablist" style={{ ['--nz-i' as string]: Math.min(tab, model.failures.length - 1), ['--nz-n' as string]: model.failures.length }}>
              <span className="nz-seg-pill" />
              {model.failures.map((item, index) => <button type="button" role="tab" key={item.id} className="nz-seg-btn" aria-selected={index === Math.min(tab, model.failures.length - 1)} onClick={() => setTab(index)}>{labelFor(item)}</button>)}
            </div>
            <FailureBody key={active.id} copy={copy} item={active} decide={decide} pending={pending} onApprove={onApprove} onSkip={onSkip} onEdit={edit} />
          </> : <p className="nz-empty">{copy.ui.noReport}</p>}
        </section>
      </div>
      <section className="nz-panel nz-report" id="nz-report" aria-label={copy.ui.report}>
        <h2>{copy.ui.report}</h2>
        {model.empty ? <p className="nz-empty" data-state="first-report">{copy.ui.firstReport}</p> : <>
        {model.suiteLabel ? <p>{model.suiteLabel}</p> : null}
        {model.before ? <div className="nz-report-scores">
          <div><p>{copy.ui.before}</p><ScoreFigure value={model.before.score} ring="coral" /></div>
          <span className="nz-arrow" aria-hidden="true">→</span>
          <div><p>{copy.ui.after}</p><ScoreFigure value={model.metrics.score} ring="teal" named={screen === 'report'} /></div>
        </div> : <div className="nz-recheck" data-state="recheck-pending">
          <p>{copy.ui.recheckPending}</p>
          {recheck && recheckReady ? <button type="button" className="nz-btn nz-btn-teal" data-action="recheck" disabled={pending} onClick={onRecheck}>{copy.ui.runRecheck}</button> : <p className="nz-note">{recheck ? copy.ui.noFixToRecheck : copy.ui.recheckNeedsRole}</p>}
        </div>}
        {model.before ? <table className="nz-table">
          <thead><tr><th>{copy.ui.measure}</th><th>{copy.ui.before}</th><th>{copy.ui.after}</th></tr></thead>
          <tbody>
            {(['score', 'critical', 'fail', 'safety', 'accuracy', 'rules', 'recovery'] as const).map((key) => {
              const before = model.before?.[key] ?? 0;
              const after = model.metrics[key];
              const better = key === 'fail' || key === 'critical' ? after < before : after > before;
              const label = key === 'score' ? copy.ui.overall : copy.ui[key];
              return <tr key={key}><th>{label}</th><td>{before}</td><td className={better ? 'is-better' : undefined}>{after}</td></tr>;
            })}
          </tbody>
        </table> : null}
        {measured ? <MeasuredTable copy={copy} lang={lang} data={measured} /> : null}
        <h3>{copy.ui.fixesApplied}</h3>
        {model.fixes.length === 0 ? <p className="nz-empty">{copy.ui.noRepair}</p> : <ul className="nz-fixes">{model.fixes.map((fix) => <li key={fix.id}><strong>{fix.title}</strong><span>{fill(copy.ui.approvedBy, { name: fix.name, role: fix.role })} {dubaiStamp(fix.at, lang)}, {copy.ui.dubai}</span></li>)}</ul>}
        <p className="nz-coverage">{model.coverage}</p>
        <button type="button" className="nz-btn nz-btn-teal" onClick={onShare}>{copy.ui.share}</button>
        {pdfHref ? <a className="nz-btn nz-btn-teal" href={pdfHref} download>{copy.ui.downloadPdf}</a> : null}
        {copied ? <p role="status">{copy.ui.linkCopied}</p> : null}
        {copyError ? <p role="status">{copy.ui.linkFailed}</p> : null}
        </>}
        {demo ? <p className="nz-footer">{copy.sample.footer}</p> : null}
      </section>
      {screen === 'failures' ? <button type="button" className="nz-backdrop nz-only-phone" aria-label={copy.ui.close} onClick={() => onScreen('chat')} /> : null}
    </div>
    <nav className="nz-tabs-bar" aria-label={copy.ui.sections}>
      {sections.map(([id, icon]) => <button type="button" key={id} className="nz-nav-btn" data-section={id} aria-current={screen === id ? 'page' : undefined} onClick={() => open(id)}><Icon name={icon} />{copy.ui[id === 'failures' ? 'failures' : id]}</button>)}
    </nav>
  </div>;
}

export type Measured = { conversations: number; runs?: number; restricted?: boolean; metrics: { id: string; value: number | null; numerator: number; denominator: number; unit: 'percent' | 'points' | 'calls' }[] };
function MeasuredTable({ copy, lang, data }: { copy: Messages; lang: Lang; data: Measured }) {
  const ui = copy.ui as unknown as Record<string, string>;
  const num = (v: number) => v.toLocaleString(lang === 'ar' ? 'ar-AE' : 'en-US');
  return <div className="nz-measured" data-state="measured">
    <h3>{ui.measured}</h3>
    {data.restricted ? <p className="nz-note" data-note="measured-restricted">{ui.measuredRestricted}</p> : data.conversations === 0 ? <p className="nz-empty">{ui.measuredEmpty}</p> : <>
      <p className="nz-note">{fill(ui.measuredNote!, { n: num(data.conversations), runs: num(data.runs ?? 0) })}</p>
      <table className="nz-table"><thead><tr><th>{copy.ui.measure}</th><th>{ui.mValue}</th><th>{ui.mBasis}</th></tr></thead><tbody>
        {data.metrics.map((m) => <tr key={m.id} data-metric={m.id}><th>{ui[`m_${m.id}`]}</th>
          <td>{m.value === null ? '' : m.unit === 'percent' ? `${num(m.value)}%` : fill(ui[m.unit === 'points' ? 'mPoints' : 'mCalls']!, { v: num(m.value) })}</td>
          <td>{num(m.numerator)} / {num(m.denominator)}</td></tr>)}
      </tbody></table></>}
  </div>;
}
