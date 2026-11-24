import Link from 'next/link';
import { Heading } from '@/components/heading';
import { BackLink } from './back-link';
import { fill, messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { Avatar } from './avatar';
import { DemoBar } from './demo-bar';
import { Bell } from './bell';
import { retestLine, type FixCard, type FixesAccess, type Tab } from './fixes-model';
import { FloatingBottomNav } from './floating-nav';
import type { HomeLinks } from './home-model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { helpLine, whoFor } from './people';
import { PillButton } from './pill-button';
import { SideNav } from './side-nav';
import { PhaseCard, StateCard } from './state-card';

export type FixesNote = 'failed' | 'runActive' | 'testStarted' | 'skippedNote' | 'copied' | 'copyFailed' | null;
export type FixAction = 'approve' | 'reject' | 'retest' | 'copy';

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

/** Waiting holds fixes still to decide. Done holds approved fixes (testing or tested) and skipped ones, on every device. */
export function inTab(item: FixCard, tab: Tab) {
  return tab === 'waiting' ? item.status === 'waiting' : item.status !== 'waiting';
}

/** The fixes screen. Plain props in, markup out, so the same view renders signed in and in tests. */
export function FixesView(props: FixesViewProps) {
  const { lang, seat, phase, fixes, access, tab, openId, busy, note, links } = props;
  const copy = messagesFor(lang);
  const text = copy.fixesScreen;
  const who = whoFor(props.person, seat, copy, phase === 'loading');
  const shown = fixes.filter((item) => inTab(item, tab));
  const open = openId ?? shown.find((item) => item.status === 'waiting')?.id ?? null;
  return (
    <main className="nz-shell nz-fixpage" {...localeAttrs(lang)} data-seat={seat} data-state={phase} data-tab={tab}>
      <div className="nz-shell-desk">
        <header className="nz-shell-head">
          <div className="nz-shell-who">
            <Link href={links.settings} aria-label={copy.shell.settings}><Avatar initials={who.initials} label={who.full} /></Link>
            <p className="nz-shell-greet"><strong>{who.name}</strong><small>{helpLine(props.assistant, copy, phase === 'loading')}</small></p>
          </div>
          <Bell lang={lang} home={links.home} />
        </header>
        <DemoBar lang={lang} />
        <div className="nz-shell-stack">
          <BackLink href={links.home} label={copy.shell.home} />
          {phase !== 'ready' ? <>
            <PhaseCard phase={phase === 'error' ? 'error' : 'loading'} copy={copy} onRetry={props.onRetry} fallback={links.home} />
          </> : <>
            <Heading light={text.light} bold={text.bold} lang={lang} flow="inline" />
            <p className="nz-check-sub">{text.intro}</p>
            {seat === 'viewer' ? <StateCard kind="view" title={copy.shell.viewOnly} /> : null}
            <div className="nz-tabs" role="tablist" aria-label={text.light}>
              {(['waiting', 'done'] as const).map((id) => (
                <button key={id} type="button" role="tab" className="nz-tab" aria-selected={tab === id} data-tab={id} onClick={() => props.onTab?.(id)}>{id === 'waiting' ? text.waiting : text.done}</button>
              ))}
            </div>
            {note ? <p className="nz-note-line" role="status" data-note={note}>{text[note]}</p> : null}
            <div className="nz-fix-list">
              <div className="nz-fix-cards">
              {shown.length === 0 ? <StateCard kind="empty" title={tab === 'waiting' ? text.emptyWaitingTitle : text.emptyDoneTitle} action={{ label: text.goChecks, href: links.checks }} /> : shown.map((item) => <FixCardView key={item.id} lang={lang} item={item} access={access} open={open === item.id} busy={busy?.id === item.id ? busy.action : null} links={links} onToggle={props.onToggle} onAction={props.onAction} />)}
              </div>
            </div>
          </>}
        </div>
      </div>
      <FloatingBottomNav lang={lang} seat={seat} copy={copy} canStart={props.canStart} current="fixes" links={navLinks(links, seat)} />
      <SideNav lang={lang} seat={seat} copy={copy} canStart={props.canStart} current="fixes" links={navLinks(links, seat)} />
    </main>
  );
}

export function navLinks(go: HomeLinks, seat: Seat) {
  // A viewer cannot read History, so More opens Settings for them.
  return { settings: go.settings, home: go.home, checks: go.checks, start: go.start, fixes: go.fixes, more: seat === 'viewer' ? go.settings : go.more };
}

function FixCardView({ lang, item, access, open, busy, links, onToggle, onAction }: {
  lang: Lang; item: FixCard; access: FixesAccess; open: boolean; busy: FixAction | null; links: HomeLinks;
  onToggle?: (id: string) => void; onAction?: (id: string, action: FixAction) => void;
}) {
  const copy = messagesFor(lang);
  const text = copy.fixesScreen;
  if (item.status !== 'waiting') {
    const skipped = item.status === 'turnedDown';
    const running = item.retest.state === 'running';
    const percent = item.retest.total ? Math.round((item.retest.done / item.retest.total) * 100) : 0;
    return (
      <article className={skipped ? 'nz-fix nz-fix-down' : 'nz-fix nz-fix-approved'} data-fix={skipped ? 'skipped' : item.retest.state} aria-busy={busy !== null}>
        <p className="nz-fix-state"><span className="nz-fix-tick"><ShellIcon name={skipped ? 'ring' : 'tick'} /></span><strong>{item.title}</strong></p>
        <p className="nz-fix-sub nz-fix-next" role={running ? 'status' : undefined}>{skipped ? text.skipped : retestLine(item, copy)}</p>
        {running ? <div className="nz-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={retestLine(item, copy)}><span style={{ inlineSize: `${percent}%` }} /></div> : null}
        {item.change ? <PillButton className="nz-fix-btn" icon="report" label={text.seeAfter} href={`${links.after}&fix=${item.id}`} /> : null}
        {!skipped && (item.retest.state === 'none' || item.retest.state === 'stopped') && access.recheck ? <PillButton className="nz-fix-btn" label={busy === 'retest' ? text.sending : text.testAgain} disabled={busy !== null} onClick={() => onAction?.(item.id, 'retest')} /> : null}
      </article>
    );
  }
  const mine = item.by.mine;
  return (
    <article className="nz-fix nz-fix-waiting" data-fix="waiting" data-own={item.ownAgent} aria-busy={busy !== null}>
      <button type="button" className="nz-fix-head" aria-expanded={open} aria-label={`${item.title}. ${open ? text.showLess : text.showMore}`} onClick={() => onToggle?.(item.id)}>
        <span className="nz-fix-title">{item.title}</span>
        <span className="nz-fix-by"><span className="nz-fix-ini" aria-hidden="true">{item.by.initials}</span><span>{fill(text.suggestedBy, { name: item.by.name })}</span></span>
      </button>
      {open ? <>
        <div className="nz-fix-card">
          <p className="nz-fix-label">{text.wrong}</p>
          <p className="nz-fix-text" dir="auto">{item.wrong}</p>
          <p className="nz-fix-label">{text.fix}</p>
          <p className="nz-fix-text nz-fix-instr" dir="auto">{item.fix}</p>
        </div>
        {item.ownAgent ? <p className="nz-fix-wait">{text.ownLine}</p> : mine ? <p className="nz-fix-wait">{text.soloLine}</p> : null}
        {access.decide ? (
          <div className="nz-fix-actions">
            {item.ownAgent ? <>
              <PillButton className="nz-fix-copy" icon="share" label={busy === 'copy' ? text.copied : text.copyChange} onClick={() => onAction?.(item.id, 'copy')} />
              <PillButton variant="ink" icon="play" className="nz-fix-approve" label={busy === 'approve' ? text.sending : text.changedTest} disabled={busy !== null && busy !== 'copy'} onClick={() => onAction?.(item.id, 'approve')} />
            </> : <PillButton variant="ink" icon="tick" className="nz-fix-approve" label={busy === 'approve' ? text.sending : text.approveTest} disabled={busy !== null} onClick={() => onAction?.(item.id, 'approve')} />}
            <PillButton className="nz-fix-turn" label={busy === 'reject' ? text.sending : text.notNow} disabled={busy !== null && busy !== 'copy'} onClick={() => onAction?.(item.id, 'reject')} />
          </div>
        ) : null}
      </> : null}
    </article>
  );
}
