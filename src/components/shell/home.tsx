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
    facts: { checks: 12, score: 82, right: 82, toFix: 3, lastAt: new Date() },
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
  person: who,
}: {
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
  const heading = headingFor(view, copy);
  const showCards = facts.checks > 0 && variant !== 'first';
  const pills = [
    access.start && variant !== 'first' ? <PillButton key="start" tone="mint" icon="play" directional label={copy.shell.startCheck} href={go.start} /> : null,
    access.fixes ? <PillButton key="fixes" tone="peach" icon="pencil" label={copy.shell.fixes} href={go.fixes} /> : null,
    access.report ? <PillButton key="report" tone="sky" icon="report" label={copy.shell.report} href={go.report} /> : null,
    access.settings ? <PillButton key="settings" tone="lilac" icon="settings" label={copy.shell.settings} href={go.settings} /> : null,
  ].filter(Boolean);
  const cards = showCards ? (
    <div className="nz-stat-row nz-stat-row-3">
      <PastelCard tone="mint" layout="stat" icon="check" title={copy.shell.rightAnswers} value={facts.right} />
      <PastelCard tone="peach" layout="stat" icon="alert" title={copy.shell.toFix} value={facts.toFix} />
      <PastelCard tone="sky" layout="stat" icon="clock" title={copy.shell.lastCheck} value={lastCheckText(facts.lastAt, now, copy)} />
    </div>
  ) : null;
  return (
    <main className="nz-shell" {...attrs} data-seat={seat} data-state={state} data-variant={variant}>
      <div className="nz-shell-desk">
        <header className="nz-shell-head">
          <div className="nz-shell-who">
            <Avatar initials={person.initials} label={person.full} />
            <p className="nz-shell-greet"><strong>{person.name}</strong><small>{assistant}</small></p>
          </div>
          <Bell label={copy.shell.alerts} empty={copy.shell.noAlerts} />
        </header>
        <div className="nz-shell-stack">
          {state !== 'ready' ? <StatePanel copy={copy} state={state} onRetry={onRetry} fallback={go.home} /> : <>
            <Heading light={heading.light} bold={heading.bold} lang={lang} />
            {variant === 'first' ? <>
              <section className="nz-first-card">
                <span className="nz-first-mark"><ShellIcon name="clock" /></span>
                <p>{copy.shell.firstCheckNote}</p>
              </section>
              <PillButton variant="ink" icon="play" directional className="nz-hero-btn" label={copy.shell.startFirst} href={go.start} />
            </> : <div className={showCards ? 'nz-shell-desk-body' : 'nz-shell-desk-body nz-shell-desk-solo'}>
              <PillGrid>{pills}</PillGrid>
              {cards}
            </div>}
            {variant === 'viewer' ? <StateCard kind="view" title={copy.shell.viewOnly} /> : null}
          </>}
        </div>
      </div>
      <FloatingBottomNav lang={lang} seat={seat} copy={copy} canStart={access.start} links={navLinks(go, seat)} />
      <SideNav lang={lang} seat={seat} copy={copy} canStart={access.start} links={navLinks(go, seat)} />
    </main>
  );
}

function navLinks(go: HomeLinks, seat: Seat) {
  // A viewer cannot read History, so More opens Settings for them.
  return { home: go.home, checks: go.checks, start: go.start, fixes: go.fixes, more: seat === 'viewer' ? go.settings : go.more };
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
