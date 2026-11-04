import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { Avatar } from './avatar';
import { Bell } from './bell';
import { betterLine, languageLine, type Change } from './fixes-model';
import { navLinks } from './fixes';
import { FloatingBottomNav } from './floating-nav';
import type { HomeLinks } from './home-model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { PastelCard } from './pastel-card';
import { personFor } from './people';
import { PillButton } from './pill-button';
import { SideNav } from './side-nav';
import { StateCard } from './state-card';

export type AfterViewProps = {
  lang: Lang;
  seat: Seat;
  phase: 'loading' | 'ready' | 'error';
  /** Null when there are not two saved checks to compare. */
  change: Change | null;
  canStart: boolean;
  assistant: string;
  person?: { initials: string; name: string };
  links: HomeLinks;
  onRetry?: () => void;
};

/** Before and after the fix. Plain props in, markup out. */
export function AfterView({ lang, seat, phase, change, canStart, assistant, person, links, onRetry }: AfterViewProps) {
  const copy = messagesFor(lang);
  const text = copy.afterScreen;
  const who = person ? { ...person, full: person.name } : personFor(seat, copy);
  const rows = change ? [
    { id: 'fixed', label: text.fixed, n: change.fixed, tone: 'right', icon: 'tick' },
    { id: 'still', label: text.stillWrong, n: change.stillWrong, tone: 'wrong', icon: 'cross' },
    { id: 'newly', label: text.newlyWrong, n: change.newlyWrong, tone: 'none', icon: 'ring' },
  ] as const : [];
  const line = change ? languageLine(change, copy) : '';
  return (
    <main className="nz-shell nz-after" {...localeAttrs(lang)} data-seat={seat} data-state={phase}>
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
          </> : <>
            <Heading light={text.light} bold={text.bold} lang={lang} flow="inline" />
            {change ? <>
              <div className="nz-after-stats">
                <PastelCard tone="peach" layout="stat" title={text.before} value={String(change.before)} caption={text.rightAnswers} />
                <PastelCard tone="mint" layout="stat" title={text.after} value={String(change.after)} caption={betterLine(change, copy)} icon={change.after >= change.before ? 'up' : 'down'} />
              </div>
              <ul className="nz-after-rows">
                {rows.map((row) => (
                  <li key={row.id} className="nz-after-row" data-row={row.id}>
                    <span className={`nz-after-ico nz-after-ico-${row.tone}`} aria-hidden="true"><ShellIcon name={row.icon === 'tick' ? 'tick' : row.icon === 'cross' ? 'cross' : 'ring'} /></span>
                    <span>{row.label} {row.n}</span>
                  </li>
                ))}
              </ul>
              {line ? <p className="nz-after-lang">{line}</p> : null}
            </> : <>
              <StateCard kind="empty" title={text.emptyTitle} body={text.emptyBody} />
              <PillButton variant="ink" icon="checks" label={text.goChecks} href={links.checks} />
            </>}
          </>}
        </div>
      </div>
      <FloatingBottomNav lang={lang} seat={seat} copy={copy} canStart={canStart} current="fixes" links={navLinks(links, seat)} />
      <SideNav lang={lang} seat={seat} copy={copy} canStart={canStart} current="fixes" links={navLinks(links, seat)} />
    </main>
  );
}
