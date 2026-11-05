import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { ScreenFrame, type Phase } from './frame';
import type { HomeLinks } from './home-model';
import { ShellIcon, type ShellIconName } from './icons';
import { PillButton } from './pill-button';
import { captionText, headlineText, languageRow, pdfHref, type ReportFacts } from './report-model';
import { StateCard } from './state-card';

export type ReportNote = 'downloading' | 'copied' | 'shareFailed' | 'sharing' | null;

export type ReportViewProps = {
  lang: Lang;
  seat: Seat;
  phase: Phase;
  /** Null when no check is saved yet. */
  facts: ReportFacts | null;
  workspaceId: string;
  assistant: string;
  person?: { initials: string; name: string };
  canStart: boolean;
  history: boolean;
  links: HomeLinks;
  now: Date;
  note: ReportNote;
  /** The PDF is for the owner and the reviewer only. Everyone else reads the numbers and sees no button that would be refused. */
  canExport?: boolean;
  onDownload?: () => void;
  onShare?: () => void;
  onRetry?: () => void;
};

function Row({ icon, tone, label, value, dot }: { icon: ShellIconName; tone: string; label: string; value?: number; dot?: boolean }) {
  return (
    <li className="nz-rep-row" data-tone={tone}>
      <span className={`nz-rep-ico nz-rep-ico-${tone}`} aria-hidden="true"><ShellIcon name={icon} /></span>
      <span className="nz-rep-label">{label}</span>
      {value !== undefined ? <strong className="nz-rep-value">{value}</strong> : null}
      {dot ? <span className="nz-rep-dot" aria-hidden="true" /> : null}
    </li>
  );
}

/** The safety report. Plain props in, markup out. */
export function ReportView(props: ReportViewProps) {
  const { lang, seat, phase, facts, links, now } = props;
  const copy = messagesFor(lang);
  const text = copy.reportScreen;
  return (
    <ScreenFrame lang={lang} seat={seat} phase={phase} name="report" className="nz-report" assistant={props.assistant} person={props.person} links={links} canStart={props.canStart} history={props.history} onRetry={props.onRetry}>
      <Heading light={text.light} bold={text.bold} lang={lang} />
            {seat === 'viewer' ? <StateCard kind="view" title={copy.shell.viewOnly} /> : null}
      {!facts ? <StateCard kind="empty" title={text.emptyTitle} action={props.canStart ? { label: copy.shell.startCheck, href: links.start } : { label: text.goHome, href: links.home }} /> : <>
        <section className="nz-rep-hero" data-tone="mint">
          <p className="nz-rep-headline">{headlineText(facts, copy)}</p>
          <p className="nz-rep-caption">{captionText(facts, props.assistant || copy.shell.helpDesk, now, copy)}</p>
        </section>
        <ul className="nz-rep-rows">
          <Row icon="tick" tone="right" label={text.fixed} value={facts.fixedThisWeek} />
          <Row icon="alert" tone="wrong" label={text.still} value={facts.toFix} />
          <Row icon="globe" tone="plain" label={languageRow(facts, copy)} dot />
        </ul>
        {props.note ? <p className="nz-note-line" role="status" data-note={props.note}>{text[props.note]}</p> : null}
        {props.canExport === false ? null : <>
        <a className="nz-pill-btn nz-pill-btn-ink nz-pill-btn-neutral nz-rep-btn" data-variant="ink" href={pdfHref(props.workspaceId, facts.id, lang)} download onClick={props.onDownload}>
          <span className="nz-pill-ico"><ShellIcon name="download" /></span><span>{text.download}</span>
        </a>
        <PillButton className="nz-rep-btn" icon="share" label={props.note === 'sharing' ? text.sharing : text.share} disabled={props.note === 'sharing'} onClick={props.onShare} />
        </>}
      </>}
    </ScreenFrame>
  );
}
