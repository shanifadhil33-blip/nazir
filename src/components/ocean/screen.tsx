'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { fill, type Lang, type Messages } from './copy';
import { canApprove, canCompose, dubaiStamp, type FailureCase, type Metrics, type ScreenId, type ScreenModel, type Seat } from './model';
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

function FailureBody({ copy, item, allow, pending, onApprove, onSkip, onEdit }: {
  copy: Messages; item: FailureCase; allow: boolean; pending: boolean;
  onApprove: (id?: string) => void; onSkip: (id?: string) => void; onEdit: () => void;
}) {
  return <div className="nz-cross" key={item.id}>
    <div className="nz-case-line"><div><p className="nz-case">{item.caseLabel}</p><h3>{copy.ui.openFailure}</h3></div><span className="nz-chip">{copy.ui.critical}</span></div>
    <p className="nz-kicker">{copy.ui.expectedVersus}</p>
    <div className="nz-versus">
      <article className="nz-expect"><h4>{copy.ui.expected}</h4><p lang="en">{item.expectedEn}</p><p lang="ar" dir="rtl">{item.expectedAr}</p></article>
      <p className="nz-versus-word">{copy.ui.versus}</p>
      <article className="nz-actual"><h4>{copy.ui.actual}</h4><p lang="en">{item.actualEn}</p><p lang="ar" dir="rtl">{item.actualAr}</p></article>
    </div>
    <div className="nz-split">
      <section><h4>{copy.ui.diagnosis}</h4><p>{item.diagnosis}</p></section>
      <section><h4>{copy.ui.proposedFix}</h4><p>{item.proposed || copy.ui.noRepair}</p></section>
    </div>
    {allow ? <div className="nz-actions">
      <button type="button" className="nz-btn nz-btn-rust" data-action="approve" disabled={pending} onClick={() => onApprove(item.proposalId)}>{pending ? <span className="nz-spin" /> : copy.ui.approve}</button>
      <button type="button" className="nz-btn nz-btn-ghost" data-action="edit" onClick={onEdit}>{copy.ui.editFix}</button>
      <button type="button" className="nz-btn nz-btn-ghost" data-action="skip" onClick={() => onSkip(item.proposalId)}>{copy.ui.skip}</button>
    </div> : null}
  </div>;
}

export function WorkspaceScreen({
  lang, copy, demo, seat, shared = false, userName, model, screen, pending = false, copied = false, copyError = false,
  onScreen, onLang, onApprove, onSkip, onReplay, onShare, onSend, onStop,
}: {
  lang: Lang; copy: Messages; demo: boolean; seat: Seat; shared?: boolean; userName: string; model: ScreenModel; screen: ScreenId;
  pending?: boolean; copied?: boolean; copyError?: boolean;
  onScreen: (screen: ScreenId) => void; onLang: (lang: Lang) => void; onApprove: (id?: string) => void; onSkip: (id?: string) => void;
  onReplay: () => void; onShare: () => void; onSend: (message: string, display?: string) => void; onStop: () => void;
}) {
  const [tab, setTab] = useState(0);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const allow = canApprove(seat, shared);
  const compose = canCompose(seat, shared);
  const active = model.failures[Math.min(tab, Math.max(0, model.failures.length - 1))];
  const labelFor = (item: FailureCase) => lang === 'ar' ? item.tabAr : item.tab;
  let step = 0;

  function edit() {
    setDraft(copy.ui.editPrompt);
  }

  return <div className="nz-app" lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} data-demo={demo ? 'true' : 'false'} data-seat={seat}>
    <header className="nz-header">
      <div className="nz-brand">
        <span className="nz-logo" aria-hidden="true">N<span className="nz-logo-dot" /></span>
        <div><p className="nz-title">{copy.name}</p><p className="nz-sub">{copy.ui.subtitle}</p></div>
      </div>
      <div className="nz-header-actions">
        {demo ? <span className="nz-pill">{copy.ui.sampleData}</span> : null}
        <div className="nz-lang" role="group" aria-label={copy.ui.english}>
          <button type="button" aria-pressed={lang === 'en'} onClick={() => onLang('en')}>EN</button>
          <span aria-hidden="true">|</span>
          <button type="button" aria-pressed={lang === 'ar'} onClick={() => onLang('ar')}>عربي</button>
        </div>
        <div className="nz-menu">
          {seat === 'viewer' ? <span className="nz-viewer">{copy.ui.viewer}</span> : null}
          <button type="button" className="nz-btn nz-btn-ghost nz-user" aria-expanded={menu} aria-haspopup="menu" aria-label={copy.ui.menu} onClick={() => setMenu((open) => !open)}>{userName}</button>
          {menu ? <div className="nz-menu-pop" role="menu">
            <Link role="menuitem" href="/api/auth/signout">{copy.ui.signOut}</Link>
            <Link role="menuitem" href="/privacy">{copy.privacy}</Link>
            <Link role="menuitem" href="/terms">{copy.terms}</Link>
          </div> : null}
        </div>
      </div>
    </header>
    <div className="nz-columns" data-screen={screen}>
      <section className="nz-panel nz-log" aria-label={copy.ui.agentLog}>
        <div className="nz-panel-head">
          <div><h2>{copy.ui.agentLog}</h2><p className="nz-status"><span className={`nz-dot nz-dot-${model.status}`} />{statusLabel(copy, model.status)}</p></div>
          {compose ? <button type="button" className="nz-btn nz-btn-ghost" data-action="replay" onClick={onReplay}>{copy.ui.replay}</button> : null}
        </div>
        <button type="button" className="nz-compact" onClick={() => onScreen('score')}>
          <span>{model.agentName}</span>
          <ScoreFigure value={model.metrics.score} compact />
          <span className="nz-compact-counts">{copy.ui.pass} {model.metrics.pass} · {copy.ui.fail} {model.metrics.fail} · {copy.ui.critical} {model.metrics.critical}</span>
        </button>
        <div className="nz-scroll">
          <ol className="nz-timeline">
            {model.events.map((event) => {
              const number = event.kind === 'user' ? null : ++step;
              return <li key={event.id} className={`nz-card nz-card-${event.kind} nz-enter`} style={{ ['--i' as string]: step }}>
                {number !== null ? <span className={event.kind === 'critical' ? 'nz-num-bubble is-critical' : 'nz-num-bubble'}>{number}</span> : null}
                <div>
                  {event.title ? <strong>{event.title}</strong> : null}
                  <p>{event.body}</p>
                  {event.kind === 'fix' && allow ? <div className="nz-actions">
                    <button type="button" className="nz-btn nz-btn-rust" data-action="approve" disabled={pending} onClick={() => onApprove(event.proposalId)}>{pending ? <span className="nz-spin" /> : copy.ui.approve}</button>
                    <button type="button" className="nz-btn nz-btn-ghost" data-action="edit" onClick={edit}>{copy.ui.editFix}</button>
                    <button type="button" className="nz-btn nz-btn-ghost" data-action="skip" onClick={() => onSkip(event.proposalId)}>{copy.ui.skip}</button>
                  </div> : null}
                  {event.kind === 'recheck' ? <button type="button" className="nz-btn nz-btn-ghost" onClick={() => onScreen('report')}>{copy.ui.report}</button> : null}
                </div>
              </li>;
            })}
          </ol>
          {model.events.length === 0 ? <p className="nz-empty">{copy.ui.noReport}</p> : null}
        </div>
        {compose ? <form className="nz-composer" onSubmit={(event) => { event.preventDefault(); if (!pending && draft.trim().length >= 2) { onSend(draft.trim()); setDraft(''); } }}>
          <button type="button" className="nz-icon-btn" data-action="attach" aria-label={copy.ui.attach}><Icon name="link" /></button>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={copy.ui.composer} aria-label={copy.ui.composer} />
          {pending ? <button type="button" className="nz-send" aria-label={copy.ui.stop} onClick={onStop}><span className="nz-spin" /></button> : <button type="submit" className="nz-send" aria-label={copy.ui.send}><Icon name="send" /></button>}
        </form> : <p className="nz-note">{copy.ui.viewerNote}</p>}
      </section>
      <div className="nz-side">
        <section className="nz-panel nz-score-panel" aria-label={copy.ui.score}>
          <div className="nz-score-top">
            <div>
              <p className="nz-agent">{model.agentName}</p>
              <ScoreFigure value={model.metrics.score} named={screen !== 'report'} caption={copy.ui.outOf} />
            </div>
          </div>
          <Counters copy={copy} metrics={model.metrics} />
          <Bars copy={copy} metrics={model.metrics} lang={lang} />
          <button type="button" className="nz-btn nz-btn-ghost" onClick={() => onScreen('report')}>{copy.ui.report}</button>
        </section>
        <section className="nz-panel nz-failure" aria-label={copy.ui.failures}
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
            <FailureBody copy={copy} item={active} allow={allow} pending={pending} onApprove={onApprove} onSkip={onSkip} onEdit={edit} />
          </> : <p className="nz-empty">{copy.ui.noReport}</p>}
        </section>
      </div>
      <section className="nz-panel nz-report" aria-label={copy.ui.report}>
        <h2>{copy.ui.report}</h2>
        <div className="nz-report-scores">
          <div><p>{copy.ui.before}</p><ScoreFigure value={model.before?.score ?? model.metrics.score} ring="coral" /></div>
          <span className="nz-arrow" aria-hidden="true">→</span>
          <div><p>{copy.ui.after}</p><ScoreFigure value={model.metrics.score} ring="teal" named={screen === 'report'} /></div>
        </div>
        <table className="nz-table">
          <thead><tr><th>{copy.ui.measure}</th><th>{copy.ui.before}</th><th>{copy.ui.after}</th></tr></thead>
          <tbody>
            {(['score', 'critical', 'fail', 'safety', 'accuracy', 'rules', 'recovery'] as const).map((key) => {
              const before = model.before?.[key] ?? model.metrics[key];
              const after = model.metrics[key];
              const better = key === 'fail' || key === 'critical' ? after < before : after > before;
              const label = key === 'score' ? copy.ui.overall : copy.ui[key];
              return <tr key={key}><th>{label}</th><td>{before}</td><td className={better ? 'is-better' : undefined}>{after}</td></tr>;
            })}
          </tbody>
        </table>
        <h3>{copy.ui.fixesApplied}</h3>
        {model.fixes.length === 0 ? <p className="nz-empty">{copy.ui.noRepair}</p> : <ul className="nz-fixes">{model.fixes.map((fix) => <li key={fix.id}><strong>{fix.title}</strong><span>{fill(copy.ui.approvedBy, { name: fix.name, role: fix.role })} {dubaiStamp(fix.at, lang)}, {copy.ui.dubai}</span></li>)}</ul>}
        <p className="nz-coverage">{model.coverage}</p>
        <button type="button" className="nz-btn nz-btn-teal" onClick={onShare}>{copy.ui.share}</button>
        {copied ? <p role="status">{copy.ui.linkCopied}</p> : null}
        {copyError ? <p role="status">{copy.ui.linkFailed}</p> : null}
        {demo ? <p className="nz-footer">{copy.sample.footer}</p> : null}
      </section>
      {screen === 'failures' ? <button type="button" className="nz-backdrop nz-only-phone" aria-label={copy.ui.close} onClick={() => onScreen('chat')} /> : null}
    </div>
    <nav className="nz-tabs-bar" aria-label={copy.ui.chat}>
      {([['chat', 'chat'], ['score', 'score'], ['failures', 'fail'], ['report', 'report']] as const).map(([id, icon]) => <button type="button" key={id} className="nz-nav-btn" aria-current={screen === id ? 'page' : undefined} onClick={() => onScreen(id)}><Icon name={icon} />{copy.ui[id === 'failures' ? 'failures' : id]}</button>)}
    </nav>
  </div>;
}
