import type { ReactNode } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { Avatar } from './avatar';
import { Bell } from './bell';
import { FloatingBottomNav } from './floating-nav';
import type { HomeLinks } from './home-model';
import { localeAttrs } from './locale';
import { personFor } from './people';
import { PillButton } from './pill-button';
import { SideNav } from './side-nav';
import { StateCard } from './state-card';

export type Phase = 'loading' | 'ready' | 'error';

/** Where the More tab goes: History for the team, Settings for a viewer who cannot read History. */
export function moreLink(links: HomeLinks, history: boolean): string {
  return history ? links.history : links.settings;
}

/** The shared page for History, Settings and Report: header, one stack, both navs. Plain props in, markup out. */
export function ScreenFrame({ lang, seat, phase, name, assistant, person, links, canStart, history, onRetry, className, children }: {
  lang: Lang;
  seat: Seat;
  phase: Phase;
  name: string;
  assistant: string;
  person?: { initials: string; name: string };
  links: HomeLinks;
  canStart: boolean;
  history: boolean;
  onRetry?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const copy = messagesFor(lang);
  const who = person ? { ...person, full: person.name } : personFor(seat, copy);
  const nav = { home: links.home, checks: links.checks, start: links.start, fixes: links.fixes, more: moreLink(links, history) };
  return (
    <main className={`nz-shell ${className ?? ''}`.trim()} {...localeAttrs(lang)} data-seat={seat} data-state={phase} data-screen={name}>
      <div className="nz-shell-desk">
        <header className="nz-shell-head">
          <div className="nz-shell-who">
            <Avatar initials={who.initials} label={who.full} />
            <p className="nz-shell-greet"><strong>{who.name}</strong><small>{assistant || copy.shell.helpDesk}</small></p>
          </div>
          <Bell label={copy.shell.alerts} empty={copy.shell.noAlerts} />
        </header>
        <div className="nz-shell-stack">
          {phase !== 'ready' ? <>
            <StateCard kind={phase === 'error' ? 'error' : 'loading'} title={phase === 'error' ? copy.shell.errorTitle : copy.shell.loadingTitle} body={phase === 'error' ? copy.shell.errorBody : copy.shell.loadingBody} />
            {phase === 'error' && onRetry ? <PillButton variant="ink" label={copy.shell.retry} onClick={onRetry} /> : null}
          </> : children}
        </div>
      </div>
      <FloatingBottomNav lang={lang} seat={seat} copy={copy} canStart={canStart} current="more" links={nav} />
      <SideNav lang={lang} seat={seat} copy={copy} canStart={canStart} current="more" links={nav} />
    </main>
  );
}
