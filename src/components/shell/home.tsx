import Link from 'next/link';
import type { ExternalView } from '@/server/settings/external-agent';
import type { RunProgress } from './checks-run';
import { progressLine, dayLabel } from './checks-model';
import { ConnectCard, ConnectChoices, AgentStatus, ConnectionLine } from './connect-card';
import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { Avatar } from './avatar';
import { Bell } from './bell';
import { FloatingBottomNav } from './floating-nav';
import { headingFor, homeLinks, lastCheckText, seatAccess, type HomeLinks, type HomeView } from './home-model';
import { localeAttrs } from './locale';
import { helpLine, whoFor } from './people';
import { PillButton } from './pill-button';
import { SideNav } from './side-nav';
import { StateCard, type ShellState } from './state-card';

/** Made up numbers for the preview page only. The signed in home gets its own view. */
export function previewView(seat: Seat): HomeView {
  const access = seatAccess(seat);
  return {
    variant: seat === 'viewer' ? 'viewer' : 'main',
    access,
    facts: { checks: 12, score: 75, right: 6, total: 8, toFix: 1, inconclusive: 1, lastAt: new Date() },
    assistant: '',
  };
}

export function ShellHome({
  lang,
  seat,
  state = 'ready',
  view = previewView(seat),
  links,
  now = new Date(),
  onRetry,
  person: who, workspaceId, kind, connection, panel, onConnected, active = [], activeStatus = 'ready',
}: {
  workspaceId?: string;
  kind?: 'real' | 'demo';
  connection?: ExternalView | null;
  panel?: 'full' | 'quick';
  onConnected?: () => void;
  active?: RunProgress[];
  activeStatus?: 'loading' | 'ready' | 'error';
  lang: Lang;
  seat: Seat;
  state?: ShellState;
  view?: HomeView;
  /** Where taps go. Without it the preview links stay on the same page. */
  links?: HomeLinks;
  now?: Date;
  onRetry?: () => void;
  /** The signed in person. Falls back to the sample person for the seat. */
  person?: { initials: string; name: string };
}) {
  const copy = messagesFor(lang);
  const person = whoFor(who, seat, copy, state === 'loading');
  const attrs = localeAttrs(lang);
  const go = links ?? homeLinks('preview');
  const { access, facts, variant } = view;
  const assistant = helpLine(view.assistant, copy, state === 'loading');
  const checkTime = facts.lastAt ? `${dayLabel(facts.lastAt, now, lang, copy)} ${new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(facts.lastAt)}` : lastCheckText(null, now, copy);
  const heading = headingFor(view, copy, active.length > 0);
  const connected = variant !== 'connect';
  const canStart = access.start && activeStatus === 'ready' && active.length === 0;
  const checkHref = facts.latestCheckId ? `${go.checks}&check=${facts.latestCheckId}` : go.checks;
  const [running, ...otherRuns] = active;
  return (
    <main className="nz-shell nz-home" {...attrs} data-seat={seat} data-state={state} data-variant={variant}>
      <div className="nz-shell-desk">
        <header className="nz-shell-head">
          <div className="nz-shell-who">
            <Link href={go.settings} aria-label={copy.shell.settings}><Avatar initials={person.initials} label={person.full} /></Link>
            <p className="nz-shell-greet"><strong>{person.name}</strong><small>{assistant}</small></p>
          </div>
          <Bell label={copy.shell.alerts} empty={copy.shell.noAlerts} />
        </header>
        <section className="nz-home-main" aria-label={heading.bold}>
          {state === 'loading' ? <div className="nz-home-loading" aria-busy="true" aria-label={copy.shell.loadingTitle}><div className="nz-home-loading-title" /><div className="nz-connect-choices"><div /><div /></div></div> : state !== 'ready' ? <StatePanel copy={copy} state={state} onRetry={onRetry} fallback={go.home} /> : <>
            <Heading light={heading.light} bold={heading.bold} lang={lang} />
            {panel ? <ConnectCard key={panel} workspaceId={workspaceId ?? 'preview'} lang={lang} mode={panel} home={go.home} connection={connection} demo={kind === 'demo'} onSaved={onConnected} /> : !connected ? <>
              <p className="nz-home-intro" dir="auto">{copy.connect.intro}</p>
              <ConnectChoices lang={lang} home={go.home} />
            </> : <>
              {kind === 'demo' ? <p className="nz-home-demo" dir="auto">{copy.connect.demoNote}</p> : <AgentStatus lang={lang} connection={connection} home={go.home} />}
              {running ? <Link className="nz-running nz-home-primary" href={`${go.checks}&run=${running.runId}`}><strong>{progressLine(running.done, running.total, copy)}</strong><progress aria-label={progressLine(running.done, running.total, copy)} max={running.total} value={running.done} /></Link> : <>
                {facts.checks === 0 ? <p className="nz-home-intro" dir="auto">{copy.shell.firstCheckNote}</p> : null}
                {canStart ? <PillButton variant="ink" icon="play" directional className="nz-hero-btn nz-home-primary" label={facts.checks === 0 ? copy.shell.startFirst : copy.shell.startCheck} href={go.start} /> : null}
              </>}
              {connected && activeStatus !== 'ready' ? <StatePanel copy={copy} state={activeStatus} onRetry={onRetry} fallback={go.home} /> : null}
              {otherRuns.map((run) => <Link className="nz-home-link" key={run.runId} href={`${go.checks}&run=${run.runId}`}>{progressLine(run.done, run.total, copy)}</Link>)}
            </>}
          </>}
        </section>
        {state === 'ready' && !panel ? <div className="nz-home-secondary">
          {!connected ? <Link className="nz-home-link" href="/demo">{copy.connect.demoLink}</Link> : <>
            {facts.checks > 0 ? <section className="nz-home-last" aria-label={copy.shell.lastCheck}>
              <p dir="auto"><ConnectionLine template={facts.inconclusive > 0 ? copy.shell.lastCheckSummaryUnsure : copy.shell.lastCheckSummary} values={{ right: { text: String(facts.right), dir: 'ltr' }, wrong: { text: String(facts.toFix), dir: 'ltr' }, inconclusive: { text: String(facts.inconclusive), dir: 'ltr' }, total: { text: String(facts.total ?? facts.right + facts.toFix + facts.inconclusive), dir: 'ltr' } }} /></p>
              <div className="nz-home-links"><Link className="nz-home-link" href={checkHref}>{copy.shell.openLastCheck}</Link><span className="nz-home-time"><bdi dir="ltr">{checkTime}</bdi></span></div>
            </section> : null}
            <div className="nz-home-links">{access.fixes ? <Link className="nz-home-link" href={go.fixes}>{copy.shell.fixes}</Link> : null}{access.report ? <Link className="nz-home-link" href={go.report}>{copy.shell.report}</Link> : null}</div>
            {variant === 'viewer' ? <p>{copy.shell.viewOnly}</p> : null}
          </>}
        </div> : null}
      </div>
      <FloatingBottomNav lang={lang} seat={seat} copy={copy} canStart={canStart} homeOnly={!connected} links={navLinks(go, seat)} />
      <SideNav lang={lang} seat={seat} copy={copy} canStart={canStart} homeOnly={!connected} links={navLinks(go, seat)} />
    </main>
  );
}

function navLinks(go: HomeLinks, seat: Seat) {
  // A viewer cannot read History, so More opens Settings for them.
  return { settings: go.settings, home: go.home, checks: go.checks, start: go.start, fixes: go.fixes, more: seat === 'viewer' ? go.settings : go.more };
}

function StatePanel({ copy, state, onRetry, fallback }: { copy: ReturnType<typeof messagesFor>; state: Exclude<ShellState, 'ready'>; onRetry?: () => void; fallback: string }) {
  const titles = {
    loading: copy.shell.loadingTitle,
    error: copy.shell.errorTitle,
    empty: copy.shell.emptyTitle,
    limit: copy.shell.limitTitle,
    offline: copy.shell.offlineTitle,
    view: copy.shell.viewOnly,
  } as const;
  const again = state === 'error' || state === 'offline';
  const action = again ? { label: copy.shell.retry, ...(onRetry ? { onClick: onRetry } : { href: fallback }) } : null;
  return <StateCard kind={state} title={titles[state]} action={action} />;
}
