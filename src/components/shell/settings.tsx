import Link from 'next/link';
import type { ReactNode } from 'react';
import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { ScreenFrame, type Phase } from './frame';
import type { HomeLinks } from './home-model';
import { ShellIcon, type ShellIconName } from './icons';
import { PillButton } from './pill-button';
import { roleLabel, topicLabel, type SettingsAccess, type SettingsView } from './settings-model';

export type ResetState = 'idle' | 'ask' | 'busy' | 'done' | 'failed';

export type SettingsViewProps = {
  lang: Lang;
  seat: Seat;
  phase: Phase;
  view: SettingsView;
  access: SettingsAccess;
  history: boolean;
  canStart: boolean;
  person?: { initials: string; name: string };
  links: HomeLinks;
  peopleOpen: boolean;
  reset: ResetState;
  onPeople?: () => void;
  onAsk?: () => void;
  onCancel?: () => void;
  onConfirm?: () => void;
  onRetry?: () => void;
};

function Card({ icon, tone, title, sub, href, children }: { icon: ShellIconName; tone: string; title: string; sub?: ReactNode; href?: string; children?: ReactNode }) {
  const body = <>
    <span className={`nz-set-ico nz-set-ico-${tone}`} aria-hidden="true"><ShellIcon name={icon} /></span>
    <span className="nz-set-text"><strong>{title}</strong>{sub ? <small>{sub}</small> : null}</span>
    {href ? <span className="nz-set-go" aria-hidden="true"><ShellIcon name="chevron" /></span> : null}
  </>;
  return href
    ? <Link href={href} className="nz-set-card nz-set-link" data-card={title}>{body}</Link>
    : <section className="nz-set-card" data-card={title}>{body}{children}</section>;
}

/** Your settings. A viewer sees the same cards without chevrons. Plain props in, markup out. */
export function SettingsViewScreen(props: SettingsViewProps) {
  const { lang, seat, phase, view, access, links } = props;
  const copy = messagesFor(lang);
  const text = copy.settingsScreen;
  const edit = access.edit;
  const to = edit ? links.editor : undefined;
  return (
    <ScreenFrame lang={lang} seat={seat} phase={phase} name="settings" assistant={view.assistant} person={props.person} links={links} canStart={props.canStart} history={props.history} onRetry={props.onRetry}>
      <Heading light={text.light} bold={text.bold} lang={lang} />
      <Card icon="robot" tone="sky" title={text.assistant} sub={<>{view.assistant}<span className="nz-set-dot" aria-hidden="true" />{text.connected}</>} href={to} />
      <Card icon="chat" tone="mint" title={text.topic} sub={topicLabel(view.topic, copy)} href={to} />
      <Card icon="globe" tone="peach" title={text.language} sub={view.language === 'ar' ? text.arabic : text.english} href={to} />
      <section className="nz-set-card nz-set-people" data-card="people" data-open={props.peopleOpen}>
        <button type="button" className="nz-set-head" aria-expanded={props.peopleOpen} aria-label={`${text.people}. ${props.peopleOpen ? text.hidePeople : text.showPeople}`} onClick={props.onPeople}>
          <span className="nz-set-ico nz-set-ico-lilac" aria-hidden="true"><ShellIcon name="people" /></span>
          <span className="nz-set-text"><strong>{text.people}</strong></span>
          <span className="nz-set-go" aria-hidden="true" data-open={props.peopleOpen}><ShellIcon name="chevron" /></span>
        </button>
        {props.peopleOpen ? <ul className="nz-set-list">
          {view.people.map((person) => (
            <li key={`${person.initials}-${person.name}`} className="nz-set-person" data-role={person.role}>
              <span className="nz-set-ini" aria-hidden="true">{person.initials}</span>
              <span className="nz-set-name">{person.name}</span>
              <span className={`nz-set-chip nz-set-chip-${person.role}`}>{roleLabel(person.role, copy)}</span>
            </li>
          ))}
        </ul> : null}
      </section>
      {access.reset ? (
        <section className="nz-set-card nz-set-reset" data-card="reset" data-reset={props.reset}>
          {props.reset === 'ask' || props.reset === 'busy' ? <>
            <p className="nz-set-sure">{text.sure}</p>
            <div className="nz-set-actions">
              <PillButton variant="ink" label={props.reset === 'busy' ? text.working : text.yes} disabled={props.reset === 'busy'} onClick={props.onConfirm} />
              <PillButton label={text.notNow} disabled={props.reset === 'busy'} onClick={props.onCancel} />
            </div>
          </> : <button type="button" className="nz-set-head" onClick={props.onAsk}>
            <span className="nz-set-ico nz-set-ico-red" aria-hidden="true"><ShellIcon name="refresh" /></span>
            <span className="nz-set-text"><strong className="nz-set-red">{text.startAgain}</strong></span>
            <span className="nz-set-go" aria-hidden="true"><ShellIcon name="chevron" /></span>
          </button>}
          {props.reset === 'done' ? <p className="nz-note-line" role="status">{text.done}</p> : null}
          {props.reset === 'failed' ? <p className="nz-note-line" role="alert">{text.failed}</p> : null}
        </section>
      ) : null}
      {!edit ? <p className="nz-view-line">{copy.shell.viewOnly}</p> : null}
    </ScreenFrame>
  );
}
