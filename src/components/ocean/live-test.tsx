'use client';

import { useEffect, useRef, useState } from 'react';
import type { Lang, Messages } from './copy';

export type LiveSide = { run_id: string; role: 'clean' | 'planted'; status: string; reply: string | null; cases: { reference: string; queue: string | null }[]; failed_checks: { id: string; en: string; ar: string }[]; reason: string | null };
const done = (s: string) => ['passed', 'failed', 'inconclusive', 'cancelled'].includes(s);

export function LiveTestPanel({ copy, lang, workspaceId, sample, reportHref, onClose }: { copy: Messages; lang: Lang; workspaceId: string; sample: boolean; reportHref: string; onClose: () => void }) {
  const t = copy.live;
  const [text, setText] = useState(t.prepared);
  const [planted, setPlanted] = useState(true);
  const [sides, setSides] = useState<LiveSide[]>([]);
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'unavailable' | 'failed' | 'limit'>('idle');
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('textarea')?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  async function run() {
    if (sample || state === 'running') return;
    setState('running'); setSides([]);
    const headers = { 'content-type': 'application/json', 'accept-language': lang };
    const start = await fetch(`/api/workspaces/${workspaceId}/live-test`, { method: 'POST', headers, body: JSON.stringify({ language: lang, complaint: text, planted }) }).catch(() => null);
    if (!start?.ok) { const code = (await start?.json().catch(() => null))?.error?.code; setState(code === 'live_test_unavailable' ? 'unavailable' : code === 'too_many' ? 'limit' : 'failed'); return; }
    const body = await start.json() as { runs: { run_id: string; role: 'clean' | 'planted' }[] };
    setSides(body.runs.map((r) => ({ ...r, status: 'running', reply: null, cases: [], failed_checks: [], reason: null })));
    const results = await Promise.all(body.runs.map(async (r) => {
      const step = await fetch(`/api/workspaces/${workspaceId}/live-test/step`, { method: 'POST', headers, body: JSON.stringify({ run_id: r.run_id }) }).catch(() => null);
      const side = step?.ok ? await step.json().catch(() => null) as LiveSide | null : null;
      if (side) setSides((all) => all.map((s) => s.run_id === side.run_id ? side : s));
      return side;
    }));
    setState(results.every((s) => s && done(s.status)) ? 'done' : 'failed');
  }

  const label = (s: string) => ({ passed: t.passed, failed: t.failed, inconclusive: t.inconclusive, queued: t.queued, running: t.running_s, cancelled: t.cancelled } as Record<string, string>)[s] ?? t.queued;
  return <div className="nz-settings-back" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="nz-settings nz-live nz-enter" role="dialog" aria-modal="true" aria-labelledby="nz-live-title" ref={dialog} lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="nz-settings-head">
        <h2 id="nz-live-title">{t.title}</h2>
        <button type="button" className="nz-btn nz-btn-ghost" data-action="close-live" onClick={onClose}>{t.close}</button>
      </div>
      <p className="nz-note">{t.intro}</p>
      <label className="nz-live-field"><span>{t.complaint}</span>
        <textarea name="complaint" rows={3} maxLength={400} value={text} onChange={(e) => setText(e.target.value)} disabled={state === 'running'} />
      </label>
      <div className="nz-live-switch">
        <button type="button" role="switch" aria-checked={planted} data-action="planted-switch" className="nz-switch" onClick={() => setPlanted((p) => !p)} disabled={state === 'running'}><span aria-hidden="true" /></button>
        <div><strong>{t.switch}</strong><p className="nz-note">{t.switchNote}</p></div>
      </div>
      <button type="button" className="nz-btn nz-btn-teal" data-action="run-live" disabled={sample || state === 'running' || text.trim().length < 8} onClick={() => void run()}>{t.run}</button>
      {sample ? <p className="nz-note" data-note="live-sample">{t.sample}</p> : null}
      {state === 'running' ? <p role="status">{t.running}</p> : null}
      {state === 'unavailable' ? <p role="status" data-note="live-unavailable">{t.unavailable}</p> : null}
      {state === 'limit' ? <p role="status">{t.limit}</p> : null}
      {state === 'failed' ? <p role="status">{t.failedRun}</p> : null}
      {sides.length ? <div className="nz-live-sides" data-state="live-sides">
        {sides.map((s) => <section key={s.run_id} className="nz-settings-card" data-side={s.role} data-status={s.status}>
          <h3>{s.role === 'clean' ? t.clean : t.planted} <span className={`nz-pill is-${s.status}`}>{label(s.status)}</span></h3>
          <p className="nz-note">{t.typed}: {text}</p>
          <h4>{t.said}</h4><p>{s.reply ?? ''}</p>
          <h4>{t.record}</h4>{s.cases.length ? <ul>{s.cases.map((c) => <li key={c.reference}>{c.reference}, {c.queue ?? ''}</li>)}</ul> : <p>{done(s.status) ? t.noRecord : ''}</p>}
          <h4>{t.checks}</h4><p>{s.failed_checks.length ? s.failed_checks.map((c) => c[lang] || c.en).join('. ') : done(s.status) ? t.none : ''}</p>
        </section>)}
      </div> : null}
      <p className="nz-note">{t.synthetic}</p>
      <a className="nz-btn nz-btn-ghost" href={reportHref}>{t.earlier}</a>
    </div>
  </div>;
}
