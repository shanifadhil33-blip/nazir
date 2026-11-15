'use client';

import { useEffect, useState } from 'react';
import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import type { SafetyDetail } from '@/server/safety/read';
import { DocumentLocale } from './document-locale';
import { ScreenFrame } from './frame';
import { historyAccess } from './history-model';
import { homeLinks } from './home-model';
import { ShellIcon } from './icons';
import { useMemberData } from './member-data';
import { PillButton } from './pill-button';
import { StateCard } from './state-card';

type Note = 'downloading' | 'copied' | 'shareFailed' | 'sharing' | null;

/** The safety report at /report/safety/<id>: verdict, scope line, every weakness, PDF and share link. */
export function SafetyReportScreen({ workspaceId, runId, initialLang }: { workspaceId: string; runId: string; initialLang: Lang }) {
  const data = useMemberData(workspaceId, initialLang, false);
  const lang = data.lang;
  const copy = messagesFor(lang);
  const text = copy.safetyScreen;
  const rep = copy.reportScreen;
  const [detail, setDetail] = useState<SafetyDetail | null | 'missing'>(null);
  const [note, setNote] = useState<Note>(null);
  useEffect(() => {
    let alive = true;
    void fetch(`/api/workspaces/${workspaceId}/safety/${runId}`, { headers: { 'accept-language': lang } })
      .then(async (r) => { if (!alive) return; setDetail(r.ok ? await r.json() as SafetyDetail : 'missing'); })
      .catch(() => { if (alive) setDetail('missing'); });
    return () => { alive = false; };
  }, [workspaceId, runId, lang]);

  async function share() {
    if (note === 'sharing') return;
    const url = window.location.href;
    setNote('sharing');
    try {
      if (typeof navigator.share === 'function') { await navigator.share({ url }); setNote(null); return; }
      await navigator.clipboard.writeText(url);
      setNote('copied');
    } catch (error) {
      setNote((error as { name?: string })?.name === 'AbortError' ? null : 'shareFailed');
    }
  }

  const phase = data.phase === 'error' || detail === 'missing' ? 'error' : data.phase === 'ready' && detail ? 'ready' : 'loading';
  const run = detail && detail !== 'missing' ? detail : null;
  const found = run ? run.weaknesses.filter((w) => w.outcome === 'broken' || w.outcome === 'partial') : [];
  const other = run ? run.weaknesses.filter((w) => w.outcome !== 'broken' && w.outcome !== 'partial') : [];
  const good = run?.verdict === 'ready_safe' || run?.verdict === 'replies_clean';
  return <>
    <DocumentLocale lang={lang} />
    <ScreenFrame lang={lang} seat={seatFromRoles(data.roles)} phase={phase} name="report" className="nz-report nz-safety-report" assistant={data.assistant} person={data.person} links={homeLinks(workspaceId)} canStart={data.canStart} history={historyAccess(data.roles)} onRetry={data.reload}>
      <Heading light={rep.light} bold={rep.bold} lang={lang} />
      {run ? <>
        <section className="nz-rep-hero" data-tone={good ? 'mint' : 'peach'}>
          {run.scope === 'replies_only' ? <p>{text.repliesOnly}</p> : null}
          {run.scope === 'sample' ? <p className="nz-rep-caption">{text.sampleLine}</p> : null}
          <p className="nz-rep-headline" data-verdict={run.verdict ?? ''}>{run.verdict ? text.verdict[run.verdict] : run.status}</p>
          <p className="nz-rep-caption" dir="auto">{run.agent ?? ''}</p>
        </section>
        {found.length === 0 ? <StateCard kind="empty" title={text.noWeakness} /> : null}
        <ul className="nz-safety-other nz-safety-report-list">
          {found.map((w) => <li key={w.family} data-severity={w.severity ?? ''}>
            <strong>{w.title[lang]}</strong>
            <span>{w.severity ? text.severity[w.severity] : ''}{w.proven ? `, ${text.proven[w.proven]}` : ''}</span>
          </li>)}
          {other.map((w) => <li key={w.family} data-outcome={w.outcome}><strong>{w.title[lang]}</strong><span>{w.reason ? text.reason[w.reason] : text.outcome[w.outcome]}</span></li>)}
        </ul>
        {run.resisted.length ? <p className="nz-check-sub nz-safety-held">{text.heldUp.replace('{n}', String(run.resisted.length))}</p> : null}
        {note ? <p className="nz-note-line" role="status" data-note={note}>{rep[note]}</p> : null}
        <a className="nz-pill-btn nz-pill-btn-ink nz-pill-btn-neutral nz-rep-btn" data-variant="ink" href={`/api/workspaces/${workspaceId}/safety/${runId}/pdf?lang=${lang}`} download onClick={() => setNote('downloading')}>
          <span className="nz-pill-ico"><ShellIcon name="download" /></span><span>{rep.download}</span>
        </a>
        <PillButton className="nz-rep-btn" icon="share" label={note === 'sharing' ? rep.sharing : rep.share} disabled={note === 'sharing'} onClick={() => void share()} />
      </> : null}
    </ScreenFrame>
  </>;
}
