import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { ScreenFrame, type Phase } from './frame';
import type { HomeLinks } from './home-model';
import { ShellIcon, type ShellIconName } from './icons';
import { StateCard } from './state-card';
import { connectHref } from './connect-request';
import { PillButton } from './pill-button';
import { topicLabel, type SettingsAccess, type SettingsView } from './settings-model';

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
  reset: ResetState;
  /** The language being saved, and whether the last save failed. */
  testPeople?: ReactNode;
  languageBusy?: Lang | null;
  languageFailed?: boolean;
  onLanguage?: (lang: Lang) => void;
  onAsk?: () => void;
  onCancel?: () => void;
  onConfirm?: () => void;
  onRetry?: () => void;
  /** Sign out goes through a server action form; tests render the button only. */
  signOut?: (formData: FormData) => void | Promise<void>;
};

function Card({ icon, tone, title, sub, children }: { icon: ShellIconName; tone: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  const body = <>
    <span className={`nz-set-ico nz-set-ico-${tone}`} aria-hidden="true"><ShellIcon name={icon} /></span>
    <span className="nz-set-text"><strong>{title}</strong>{sub ? <small dir="auto">{sub}</small> : null}</span>
  </>;
  return children ? <section className="nz-set-card nz-set-with-content" data-card={title}><div className="nz-set-card-summary">{body}</div><div className="nz-set-card-content">{children}</div></section> : <section className="nz-set-card nz-set-flat" data-card={title}>{body}</section>;
}

/** Your settings: your agent, your language, its topic, and your account. Everything stays in this frame. */
export function SettingsViewScreen(props: SettingsViewProps) {
  const { lang, seat, phase, view, access, links } = props;
  const copy = messagesFor(lang);
  const text = copy.settingsScreen;
  const status = copy.agentStatus;
  const map = `${links.home}?screen=map&lang=${lang}`;
  return (
    <ScreenFrame lang={lang} seat={seat} phase={phase} name="settings" assistant={view.assistant} person={props.person} links={links} canStart={props.canStart} history={props.history} onRetry={props.onRetry}>
      <Heading light={text.light} bold={text.bold} lang={lang} />
      <p className="nz-check-sub">{text.line}</p>
      <Card icon="robot" tone="sky" title={text.assistant} sub={view.demo ? status.sampleName : view.connected ? view.agentName ?? view.assistant : status.none}>
        {view.demo ? <><p>{copy.connect.demoNote}</p><div className="nz-agent-actions"><PillButton label={copy.mapScreen.open} href={map} /></div></> : <>
          {view.connected ? <p data-kind={view.kind}>{view.kind === 'sdk' ? status.fullCheck : status.repliesOnly}{view.host ? <><br /><span className="nz-set-host">{text.address}: <bdi dir="ltr">{view.host}</bdi></span></> : null}</p> : null}
          {access.edit ? <div className="nz-agent-actions">
            <PillButton label={status.change} href={connectHref(links.home, 'quick', lang)} />
            {view.kind !== 'sdk' ? <PillButton label={status.addSdk} href={connectHref(links.home, 'full', lang)} /> : null}
            {view.connected ? <PillButton label={copy.mapScreen.open} href={map} /> : null}
          </div> : null}
          {props.testPeople}
        </>}
      </Card>
      <section className="nz-set-card nz-set-with-content" data-card="language">
        <div className="nz-set-card-summary">
          <span className="nz-set-ico nz-set-ico-peach" aria-hidden="true"><ShellIcon name="globe" /></span>
          <span className="nz-set-text"><strong>{text.language}</strong><small>{text.languageNote}</small></span>
        </div>
        <div className="nz-set-card-content">
          <div className="nz-tabs nz-set-lang" role="group" aria-label={text.language}>
            {(['en', 'ar'] as const).map((id) => <button key={id} type="button" className="nz-tab" data-lang={id} lang={id} aria-pressed={view.language === id} disabled={Boolean(props.languageBusy)} onClick={() => { if (view.language !== id) props.onLanguage?.(id); }}>{id === 'en' ? 'English' : 'العربية'}</button>)}
          </div>
          {props.languageFailed ? <p className="nz-note-line" role="alert">{text.languageFailed}</p> : null}
        </div>
      </section>
      <Card icon="chat" tone="mint" title={text.topic} sub={topicLabel(view.topic, copy)} />
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
            <span className="nz-set-text"><strong className="nz-set-red">{text.resetDemo}</strong><small>{text.resetLine}</small></span>
            <span className="nz-set-go" aria-hidden="true"><ShellIcon name="chevron" /></span>
          </button>}
          {props.reset === 'done' ? <p className="nz-note-line" role="status">{text.done}</p> : null}
          {props.reset === 'failed' ? <p className="nz-note-line" role="alert">{text.failed}</p> : null}
        </section>
      ) : null}
      <form action={props.signOut} className="nz-set-card nz-set-signout" data-card="signout">
        <SignOutButton label={text.signOut} busy={text.signingOut} />
      </form>
      {!access.edit ? <StateCard kind="view" title={copy.shell.viewOnly} /> : null}
    </ScreenFrame>
  );
}

function SignOutButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="nz-set-head" disabled={pending}>
      <span className="nz-set-ico nz-set-ico-lilac" aria-hidden="true"><ShellIcon name="people" /></span>
      <span className="nz-set-text"><strong>{pending ? busy : label}</strong></span>
    </button>
  );
}
