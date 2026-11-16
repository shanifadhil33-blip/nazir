import Link from 'next/link';
import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { ScreenFrame, type Phase } from './frame';
import { clockText, dayText, groupByDay, sentenceFor, type HistoryItem } from './history-model';
import type { HomeLinks } from './home-model';
import { ShellIcon } from './icons';
import { PillButton } from './pill-button';
import { StateCard } from './state-card';

export type HistoryViewProps = {
  lang: Lang;
  seat: Seat;
  phase: Phase;
  /** False when the server would not let this person read History. */
  allowed: boolean;
  items: HistoryItem[];
  now: Date;
  /** Whether older days are open. Today and Yesterday always show. */
  older: boolean;
  assistant: string;
  person?: { initials: string; name: string };
  canStart: boolean;
  links: HomeLinks;
  more?: boolean;
  busy?: boolean;
  failed?: boolean;
  onOlder?: () => void;
  onRetry?: () => void;
};

function Row({ item, lang, older }: { item: HistoryItem; lang: Lang; older: boolean }) {
  const copy = messagesFor(lang);
  return (
    <li className="nz-hist-row" data-kind={item.kind}>
      {(() => {
        const body = <>
          <span className="nz-hist-ini" aria-hidden="true"><ShellIcon name={item.who ? 'wrench' : 'check'} /></span>
          <span className="nz-hist-text"><strong>{sentenceFor(item, copy)}</strong><small dir="auto">{item.detail}</small></span>
          <time className="nz-hist-time" dateTime={item.at.toISOString()}>{older ? `${dayText(item.at, lang)} ${clockText(item.at, lang)}` : clockText(item.at, lang)}</time>
        </>;
        return item.href ? <Link className="nz-hist-link" href={item.href}>{body}</Link> : body;
      })()}
    </li>
  );
}

/** What happened: plain sentences grouped by day. Plain props in, markup out. */
export function HistoryView(props: HistoryViewProps) {
  const { lang, seat, phase, items, now, links } = props;
  const copy = messagesFor(lang);
  const text = copy.historyScreen;
  const groups = groupByDay(items, now);
  // Nothing today or yesterday: show the older days at once instead of an empty page with Show older.
  const older = props.older || (groups.today.length === 0 && groups.yesterday.length === 0);
  const sections = [
    { id: 'today', title: text.today, rows: groups.today, older: false },
    { id: 'yesterday', title: text.yesterday, rows: groups.yesterday, older: false },
    ...(older ? [{ id: 'earlier', title: text.earlier, rows: groups.earlier, older: true }] : []),
  ].filter((section) => section.rows.length > 0);
  return (
    <ScreenFrame lang={lang} seat={seat} phase={phase} name="history" assistant={props.assistant} person={props.person} links={links} canStart={props.canStart} history={props.allowed} onRetry={props.onRetry}>
      {!props.allowed ? <>
        <Heading light={text.light} bold={text.bold} lang={lang} />
        <StateCard kind="view" title={text.noAccessTitle} action={{ label: text.goHome, href: links.home }} />
      </> : <>
        <Heading light={text.light} bold={text.bold} lang={lang} />
        {items.length === 0 ? <StateCard kind="empty" title={text.emptyTitle} action={props.canStart ? { label: copy.shell.startCheck, href: links.start } : { label: text.goHome, href: links.home }} /> : <>
          {sections.map((section) => (
            <section key={section.id} className="nz-hist-group" data-group={section.id} aria-label={section.title}>
              <h2 className="nz-hist-day">{section.title}</h2>
              <ul className="nz-hist-list">{section.rows.map((item) => <Row key={item.id} item={item} lang={lang} older={section.older} />)}</ul>
            </section>
          ))}
          {props.failed ? <button type="button" className="nz-text-link" onClick={props.onRetry}>{copy.shell.retry}</button> : null}
          {(groups.earlier.length > 0 && !older) || props.more ? <PillButton className="nz-hist-more" label={text.showOlder} disabled={props.busy} onClick={props.onOlder} /> : null}
        </>}
      </>}
    </ScreenFrame>
  );
}

