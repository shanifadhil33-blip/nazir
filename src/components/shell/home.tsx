import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { Avatar } from './avatar';
import { FloatingBottomNav } from './floating-nav';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { PastelCard } from './pastel-card';
import { personFor } from './people';
import { PillButton } from './pill-button';
import { PillGrid } from './pill-grid';
import { SideNav } from './side-nav';
import { StateCard, type ShellState } from './state-card';
import { WhiteCard } from './white-card';

export function ShellHome({
  lang,
  seat,
  state = 'ready',
  right = 82,
  toFix = 3,
}: {
  lang: Lang;
  seat: Seat;
  state?: ShellState;
  right?: number;
  toFix?: number;
}) {
  const copy = messagesFor(lang);
  const person = personFor(seat, copy);
  const attrs = localeAttrs(lang);
  return (
    <main className="nz-shell" {...attrs} data-seat={seat} data-state={state}>
      <div className="nz-shell-phone">
        <header className="nz-shell-head">
          <div className="nz-shell-who">
            <Avatar initials={person.initials} label={person.name} />
            <p className="nz-shell-greet"><small>{copy.shell.goodMorning}</small><strong>{person.name}</strong></p>
          </div>
          <Bell label={copy.shell.alerts} />
        </header>
        <div className="nz-shell-stack">
          {state === 'ready' ? <>
            <Heading light={copy.shell.assistantLine} bold={copy.shell.doingWell} lang={lang} />
            <label className="nz-shell-search">
              <ShellIcon name="search" />
              <span className="nz-sr">{copy.shell.checkAssistant}</span>
              <input type="search" placeholder={copy.shell.checkAssistant} />
            </label>
            <WhiteCard kicker={copy.shell.assistant} title={copy.shell.helpDesk} live />
            <div className="nz-stat-row">
              <PastelCard tone="mint" layout="compact" icon="check" title={copy.shell.right} value={right} caption={copy.shell.answers} />
              <PastelCard tone="peach" layout="compact" icon="dot" title={copy.shell.toFix} value={toFix} caption={copy.shell.questions} />
            </div>
            <PillGrid>
              <PillButton tone="mint" icon="play" directional label={copy.shell.startCheck} />
              <PillButton tone="sky" icon="eye" label={copy.shell.seeMistakes} />
              <PillButton tone="peach" icon="pencil" label={copy.shell.reviewFixes} />
              <PillButton tone="lilac" icon="clock" label={copy.shell.history} />
            </PillGrid>
          </> : <StatePanel copy={copy} state={state} />}
        </div>
      </div>
      <div className="nz-shell-desk">
        <header className="nz-shell-head">
          <div className="nz-shell-who">
            <Avatar initials={person.initials} label={person.full} />
            <p className="nz-shell-greet"><strong>{person.full}</strong><small>{copy.shell.helpDesk}</small></p>
          </div>
          <Bell label={copy.shell.alerts} />
        </header>
        <div className="nz-shell-stack">
          {state === 'ready' ? <>
            <Heading flow="inline" light={copy.shell.assistantIs} bold={copy.shell.mostlySafe} lang={lang} />
            <div className="nz-shell-desk-body">
              <PillGrid>
                <PillButton icon="play" directional label={copy.shell.startCheck} />
                <PillButton icon="pencil" label={copy.shell.fixes} />
                <PillButton icon="report" label={copy.shell.report} />
                <PillButton icon="settings" label={copy.shell.settings} />
              </PillGrid>
              <div className="nz-stat-row nz-stat-row-3">
                <PastelCard tone="mint" layout="stat" icon="check" title={copy.shell.rightAnswers} value={right} />
                <PastelCard tone="peach" layout="stat" icon="alert" title={copy.shell.toFix} value={toFix} />
                <PastelCard tone="sky" layout="stat" icon="clock" title={copy.shell.lastCheck} value={copy.shell.today} />
              </div>
            </div>
          </> : <StatePanel copy={copy} state={state} />}
        </div>
      </div>
      <FloatingBottomNav lang={lang} seat={seat} copy={copy} />
      <SideNav lang={lang} seat={seat} copy={copy} />
    </main>
  );
}

function Bell({ label }: { label: string }) {
  return (
    <button type="button" className="nz-bell" aria-label={label}>
      <ShellIcon name="bell" />
    </button>
  );
}

function StatePanel({ copy, state }: { copy: ReturnType<typeof messagesFor>; state: Exclude<ShellState, 'ready'> }) {
  const panels = {
    loading: [copy.shell.loadingTitle, copy.shell.loadingBody],
    error: [copy.shell.errorTitle, copy.shell.errorBody],
    empty: [copy.shell.emptyTitle, copy.shell.emptyBody],
    limit: [copy.shell.limitTitle, copy.shell.limitBody],
  } as const;
  const [title, body] = panels[state];
  return <StateCard kind={state} title={title} body={body} />;
}
