import Link from 'next/link';
import type { ExternalView } from '@/server/settings/external-agent';
import type { RunProgress } from './checks-run';
import { progressLine, dayLabel } from './checks-model';
import { ConnectCard, ConnectChoices, AgentStatus } from './connect-card';
import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { Avatar } from './avatar';
import { Bell } from './bell';
import { FloatingBottomNav } from './floating-nav';
import { ShellIcon } from './icons';
import { headingFor, homeLinks, lastCheckText, seatAccess, type HomeLinks, type HomeView } from './home-model';
import { localeAttrs } from './locale';
import { PastelCard } from './pastel-card';
import { helpLine, whoFor } from './people';
import { PillButton } from './pill-button';
import { PillGrid } from './pill-grid';
import { SideNav } from './side-nav';
import { StateCard, type ShellState } from './state-card';

/** Made up numbers for the preview page only. The signed in home gets its own view. */
export function previewView(seat: Seat): HomeView {
  const access = seatAccess(seat);
  return {
    variant: seat === 'viewer' ? 'viewer' : 'main',
    access,
    facts: { checks: 12, score: 82, right: 82, total: 100, toFix: 3, lastAt: new Date() },
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
  const heading = headingFor(view, copy);
  const connected = variant !== 'connect';
  const canStart = access.start && activeStatus === 'ready' && active.length === 0;
  const showCards = connected && facts.checks > 0 && variant !== 'first';
  const pills = [
    canStart && variant !== 'first' ? <PillButton key="start" tone="mint" icon="play" directional label={copy.shell.startCheck} href={go.start} /> : null,
    <PillButton key="wrong" tone="peach" icon="alert" label={copy.shell.wrongAnswers} href={facts.latestCheckId ? `${go.checks}&check=${facts.latestCheckId}` : go.checks} />,
    access.fixes ? <PillButton key="fixes" tone="peach" icon="pencil" label={copy.shell.fixes} href={go.fixes} /> : null,
    access.report ? <PillButton key="report" tone="sky" icon="report" label={copy.shell.report} href={go.report} /> : null,
  ].filter(Boolean);
  const checkHref = facts.latestCheckId ? `${go.checks}&check=${facts.latestCheckId}` : go.checks;
  const cards = showCards ? (
    <div className="nz-stat-row nz-stat-row-3">
      <PastelCard tone="mint" layout="stat" icon="check" href={checkHref} title={copy.shell.rightAnswers} value={copy.shell.answerCount.replace('{right}', String(facts.right)).replace('{total}', String(facts.total ?? facts.right + facts.toFix))} />
      <PastelCard tone="peach" layout="stat" icon="alert" href={checkHref} title={copy.shell.wrongAnswers} value={facts.toFix} />
      <PastelCard tone="sky" layout="stat" icon="clock" href={checkHref} title={copy.shell.lastCheck} value={checkTime} />
    </div>
  ) : null;
  return (
    <main className="nz-shell" {...attrs} data-seat={seat} data-state={state} data-variant={variant}>
      <div className="nz-shell-desk">
        <header className="nz-shell-head">
          <div className="nz-shell-who">
            <Link href={go.settings} aria-label={copy.shell.settings}><Avatar initials={person.initials} label={person.full} /></Link>
            <p className="nz-shell-greet"><strong>{person.name}</strong><small>{assistant}</small></p>
          </div>
          <Bell label={copy.shell.alerts} empty={copy.shell.noAlerts} />
        </header>
        <div className="nz-shell-stack">
          {state === 'loading' ? <div className="nz-home-loading" aria-busy="true" aria-label={copy.shell.loadingTitle}><div className="nz-home-loading-title" /><div className="nz-connect-choices"><div /><div /></div></div> : state !== 'ready' ? <StatePanel copy={copy} state={state} onRetry={onRetry} fallback={go.home} /> : <>
            {connected && activeStatus !== 'ready' ? <StatePanel copy={copy} state={activeStatus} onRetry={onRetry} fallback={go.home} /> : null}
            {active.map((run) => <Link key={run.runId} className="nz-running" href={`${go.checks}&run=${run.runId}`}><strong>{progressLine(run.done, run.total, copy)}</strong><progress max={run.total} value={run.done} /></Link>)}
            <Heading light={heading.light} bold={heading.bold} lang={lang} />
            {variant === 'connect' ? <p className="nz-home-intro">{copy.connect.intro}</p> : facts.lastAt && showCards ? <p>{copy.shell.checkTime.replace('{time}', checkTime)}</p> : null}
            {panel ? <ConnectCard key={panel} workspaceId={workspaceId ?? 'preview'} lang={lang} mode={panel} home={go.home} connection={connection} demo={kind === 'demo'} onSaved={onConnected} /> : variant === 'connect' ? <><ConnectChoices lang={lang} home={go.home} /><Link className="nz-connect-back" href="/demo">{copy.connect.demoLink}</Link></> : null}
            {connected && !panel ? <>{variant === 'first' ? <>
              <section className="nz-first-card">
                <span className="nz-first-mark"><ShellIcon name="clock" /></span>
                <p>{copy.shell.firstCheckNote}</p>
              </section>
              {canStart ? <PillButton variant="ink" icon="play" directional className="nz-hero-btn" label={copy.shell.startFirst} href={go.start} /> : null}
            </> : <div className={showCards ? 'nz-shell-desk-body' : 'nz-shell-desk-body nz-shell-desk-solo'}>
              <PillGrid>{pills}</PillGrid>
              {cards}
            </div>}
            {variant === 'viewer' ? <StateCard kind="view" title={copy.shell.viewOnly} /> : null}
            {kind === 'demo' ? <p className="nz-agent-status">{copy.connect.demoNote}</p> : workspaceId ? <AgentStatus lang={lang} connection={connection} home={go.home} /> : null}
            </> : null}
          </>}
        </div>
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
