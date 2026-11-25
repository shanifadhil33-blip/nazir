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
import { rowLine } from './safety';
import { dateTimeLabel } from './checks-model';
import { useMemberSnapshot } from './member-snapshot';

type Note = 'downloading' | 'copied' | 'shareFailed' | 'sharing' | null;

/** The safety report at /report/safety/<id>: verdict, scope line, every weakness, PDF and share link. */
export function SafetyReportScreen({ workspaceId, runId, initialLang }: { workspaceId: string; runId: string; initialLang: Lang }) {
  const data = useMemberData(workspaceId, initialLang, false);
  const lang = data.lang;
  const copy = messagesFor(lang);
  const text = copy.safetyScreen;
  const rep = copy.reportScreen;
  const snapshotDetail = useMemberSnapshot(workspaceId)?.safetyDetail;
  const initial = snapshotDetail?.id === runId ? snapshotDetail : null;
  const [detail, setDetail] = useState<SafetyDetail | null | 'missing'>(initial);
  const [requestVersion, setRequestVersion] = useState(0);
  const [note, setNote] = useState<Note>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  useEffect(() => {
    if (initial && requestVersion === 0) return;
    let alive = true;
    void fetch(`/api/workspaces/${workspaceId}/safety/${runId}`, { headers: { 'accept-language': lang } })
      .then(async (r) => { const body = r.ok ? await r.json() as SafetyDetail : 'missing'; if (alive) setDetail(body); })
      .catch(() => { if (alive) setDetail('missing'); });
    return () => { alive = false; };
  }, [workspaceId, runId, lang, initial, requestVersion]);

  async function share() {
    if (note === 'sharing') return;
    const url = window.location.href;
    setNote('sharing');
    setShareUrl(null);
    try {
      if (typeof navigator.share === 'function') { await navigator.share({ url }); setNote(null); return; }
      await navigator.clipboard.writeText(url);
      setNote('copied');
    } catch (error) {
      const cancelled = (error as { name?: string })?.name === 'AbortError';
      setNote(cancelled ? null : 'shareFailed');
      if (!cancelled) setShareUrl(url);
    }
  }

  const phase = data.phase === 'error' || detail === 'missing' ? 'error' : data.phase === 'ready' && detail ? 'ready' : 'loading';
  const run = detail && detail !== 'missing' ? detail : null;
  const found = run ? run.weaknesses.filter((w) => w.outcome === 'broken' || w.outcome === 'partial') : [];
  const other = run ? run.weaknesses.filter((w) => w.outcome !== 'broken' && w.outcome !== 'partial') : [];
  const good = run?.verdict === 'ready_safe' || run?.verdict === 'replies_clean';
  return <>
    <DocumentLocale lang={lang} />
    <ScreenFrame lang={lang} seat={seatFromRoles(data.roles)} phase={phase} name="report" className="nz-report nz-safety-report" assistant={data.assistant} person={data.person} links={homeLinks(workspaceId, lang)} canStart={data.canStart} history={historyAccess(data.roles)} back={{ href: `/w/${workspaceId}?screen=checks&tab=safety&safety=${runId}&lang=${lang}`, label: text.safety }} onRetry={() => { setDetail(null); setRequestVersion((n) => n + 1); data.reload(); }}>
      <Heading light={rep.light} bold={rep.bold} lang={lang} />
      {run ? <>
        <section className="nz-rep-hero" data-tone={good ? 'mint' : 'peach'}>
          {run.scope === 'replies_only' ? <p>{text.repliesOnly}</p> : null}
          {run.scope === 'sample' ? <p className="nz-rep-caption">{text.sampleLine}</p> : null}
          <p className="nz-rep-headline" data-verdict={run.verdict ?? ''}>{rowLine(run, lang)}</p>
          <p className="nz-rep-caption" dir="auto">{run.agent ?? ''}</p>
          <p className="nz-check-sub nz-safety-date"><time data-safety-id={run.id} dateTime={new Date(run.at).toISOString()}>{dateTimeLabel(new Date(run.at), lang, true)}</time></p>
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
        {shareUrl ? <label className="nz-share-link">{rep.manualLink}<input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /></label> : null}
        <a className="nz-pill-btn nz-pill-btn-ink nz-pill-btn-neutral nz-rep-btn" data-variant="ink" href={`/api/workspaces/${workspaceId}/safety/${runId}/pdf?lang=${lang}`} download onClick={() => setNote('downloading')}>
          <span className="nz-pill-ico"><ShellIcon name="download" /></span><span>{rep.download}</span>
        </a>
        <PillButton className="nz-rep-btn" icon="share" label={note === 'sharing' ? rep.sharing : rep.share} disabled={note === 'sharing'} onClick={() => void share()} />
      </> : null}
    </ScreenFrame>
  </>;
}
