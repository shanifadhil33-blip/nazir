import { Heading } from '@/components/heading';
import { fill, messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { Avatar } from './avatar';
import { Bell } from './bell';
import { recheckLine, type FixCard, type FixesAccess, type Tab } from './fixes-model';
import { FloatingBottomNav } from './floating-nav';
import type { HomeLinks } from './home-model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { personFor } from './people';
import { PillButton } from './pill-button';
import { SideNav } from './side-nav';
import { StateCard } from './state-card';

export type FixesNote = 'failed' | 'rerunStarted' | 'rerunFailed' | 'approvedNote' | 'turnedNote' | null;
export type FixAction = 'approve' | 'reject' | 'recheck';

export type FixesViewProps = {
  lang: Lang;
  seat: Seat;
  phase: 'loading' | 'ready' | 'error';
  fixes: FixCard[];
  access: FixesAccess;
  canStart: boolean;
  assistant: string;
  person?: { initials: string; name: string };
  links: HomeLinks;
  tab: Tab;
  /** The card with its details open. */
  openId: string | null;
  /** The card and action in flight, so the tap shows it was heard. */
  busy: { id: string; action: FixAction } | null;
  note: FixesNote;
  onTab?: (tab: Tab) => void;
  onToggle?: (id: string) => void;
  onAction?: (id: string, action: FixAction) => void;
  onRetry?: () => void;
};

/** Waiting holds fixes to decide and approved fixes still to check again. Done holds the rest. */
export function inTab(item: FixCard, tab: Tab) {
  const waiting = item.status === 'waiting' || (item.status === 'approved' && !item.rerun);
  return tab === 'waiting' ? waiting : !waiting;
}

/** The fixes screen. Plain props in, markup out, so the same view renders signed in and in tests. */
export function FixesView(props: FixesViewProps) {
  const { lang, seat, phase, fixes, access, tab, openId, busy, note, links } = props;
  const copy = messagesFor(lang);
  const text = copy.fixesScreen;
  const who = props.person ? { ...props.person, full: props.person.name } : personFor(seat, copy);
  const shown = fixes.filter((item) => inTab(item, tab));
  const open = openId ?? shown.find((item) => item.status === 'waiting')?.id ?? null;
  return (
    <main className="nz-shell nz-fixes" {...localeAttrs(lang)} data-seat={seat} data-state={phase} data-tab={tab}>
      <div className="nz-shell-desk">
        <header className="nz-shell-head">
          <div className="nz-shell-who">
            <Avatar initials={who.initials} label={who.full} />
            <p className="nz-shell-greet"><strong>{who.name}</strong><small>{props.assistant || copy.shell.helpDesk}</small></p>
          </div>
          <Bell label={copy.shell.alerts} empty={copy.shell.noAlerts} />
        </header>
        <div className="nz-shell-stack">
          {phase !== 'ready' ? <>
            <StateCard kind={phase === 'error' ? 'error' : 'loading'} title={phase === 'error' ? copy.shell.errorTitle : copy.shell.loadingTitle} body={phase === 'error' ? copy.shell.errorBody : copy.shell.loadingBody} />
            {phase === 'error' && props.onRetry ? <PillButton variant="ink" label={copy.shell.retry} onClick={props.onRetry} /> : null}
          </> : <>
            <Heading light={text.light} bold={text.bold} lang={lang} flow="inline" />
            <div className="nz-tabs" role="tablist" aria-label={text.light}>
              {(['waiting', 'done'] as const).map((id) => (
                <button key={id} type="button" role="tab" className="nz-tab" aria-selected={tab === id} data-tab={id} onClick={() => props.onTab?.(id)}>{id === 'waiting' ? text.waiting : text.done}</button>
              ))}
            </div>
            {note ? <p className="nz-note-line" role="status" data-note={note}>{text[note]}</p> : null}
            <div className="nz-fix-list">
              {shown.length === 0 ? <>
                <StateCard kind="empty" title={tab === 'waiting' ? text.emptyWaitingTitle : text.emptyDoneTitle} body={tab === 'waiting' ? text.emptyWaitingBody : text.emptyDoneBody} />
                <PillButton variant="ink" icon="checks" label={text.goChecks} href={links.checks} />
              </> : shown.map((item) => <FixCardView key={item.id} lang={lang} item={item} access={access} open={open === item.id} busy={busy?.id === item.id ? busy.action : null} links={links} onToggle={props.onToggle} onAction={props.onAction} />)}
              {fixes.length > 0 ? <PillButton className="nz-fix-change" icon="report" label={text.seeChange} href={links.after} /> : null}
            </div>
          </>}
        </div>
      </div>
      <FloatingBottomNav lang={lang} seat={seat} copy={copy} canStart={props.canStart} current="fixes" links={navLinks(links)} />
      <SideNav lang={lang} seat={seat} copy={copy} canStart={props.canStart} current="fixes" links={navLinks(links)} />
    </main>
  );
}

export function navLinks(go: HomeLinks) {
  return { home: go.home, checks: go.checks, start: go.start, fixes: go.fixes, more: go.more };
}

function FixCardView({ lang, item, access, open, busy, links, onToggle, onAction }: {
  lang: Lang; item: FixCard; access: FixesAccess; open: boolean; busy: FixAction | null; links: HomeLinks;
  onToggle?: (id: string) => void; onAction?: (id: string, action: FixAction) => void;
}) {
  const copy = messagesFor(lang);
  const text = copy.fixesScreen;
  if (item.status === 'approved' || item.status === 'turnedDown') {
    const approved = item.status === 'approved';
    return (
      <article className={approved ? 'nz-fix nz-fix-approved' : 'nz-fix nz-fix-down'} data-fix={item.status} aria-busy={busy !== null}>
        <p className="nz-fix-state"><span className="nz-fix-tick"><ShellIcon name="check" /></span><strong>{approved ? text.approved : text.turnedDown}</strong></p>
        <p className="nz-fix-sub">{approved ? (item.rerun ? text.checkingAgain : text.readyAgain) : item.title}</p>
        {approved && !item.rerun && access.recheck ? <PillButton className="nz-fix-btn" label={busy === 'recheck' ? text.sending : text.checkAgain} disabled={busy !== null} onClick={() => onAction?.(item.id, 'recheck')} /> : null}
        {approved && item.rerun ? <PillButton className="nz-fix-btn" label={text.seeChange} href={links.after} /> : null}
      </article>
    );
  }
  const mine = item.by.mine;
  return (
    <article className="nz-fix nz-fix-waiting" data-fix="waiting" aria-busy={busy !== null}>
      <button type="button" className="nz-fix-head" aria-expanded={open} aria-label={`${item.title}. ${open ? text.showLess : text.showMore}`} onClick={() => onToggle?.(item.id)}>
        <span className="nz-fix-title">{item.title}</span>
        <span className="nz-fix-by"><span className="nz-fix-ini" aria-hidden="true">{item.by.initials}</span><span>{fill(text.suggestedBy, { name: item.by.name })}</span></span>
      </button>
      {open ? <>
        <div className="nz-fix-card">
          <p className="nz-fix-label">{text.wrong}</p>
          <p className="nz-fix-text">{item.wrong}</p>
          <p className="nz-fix-label">{text.fix}</p>
          <p className="nz-fix-text">{item.fix}</p>
        </div>
        <p className="nz-fix-recheck">{recheckLine(item.recheck, copy)}</p>
        {access.decide && !mine ? (
          <div className="nz-fix-actions">
            <PillButton variant="ink" icon="check" className="nz-fix-approve" label={busy === 'approve' ? text.sending : text.approve} disabled={busy !== null} onClick={() => onAction?.(item.id, 'approve')} />
            <PillButton className="nz-fix-turn" label={busy === 'reject' ? text.sending : text.turnDown} disabled={busy !== null} onClick={() => onAction?.(item.id, 'reject')} />
          </div>
        ) : <p className="nz-fix-wait">{text.someoneElse}</p>}
      </> : null}
    </article>
  );
}
