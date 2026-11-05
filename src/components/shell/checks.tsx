import { Heading } from '@/components/heading';
import { fill, messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { Avatar } from './avatar';
import { Bell } from './bell';
import { Chip } from './chip';
import { dayLabel, kindLabel, progressLine, progressPercent, resultLabel, type CheckRow, type ChecksAccess, type Mark } from './checks-model';
import type { RunProgress } from './checks-run';
import { FloatingBottomNav } from './floating-nav';
import type { HomeLinks } from './home-model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { helpLine, whoFor } from './people';
import { PillButton } from './pill-button';
import { SideNav } from './side-nav';
import { PhaseCard, StateCard } from './state-card';

export type ChecksNote = 'limit' | 'unreachable' | 'stopped' | 'startFailed' | 'stopFailed' | 'suggested' | 'suggestFailed' | null;

export type ChecksViewProps = {
  lang: Lang;
  seat: Seat;
  phase: 'loading' | 'ready' | 'error';
  checks: CheckRow[];
  access: ChecksAccess;
  assistant: string;
  person?: { initials: string; name: string };
  links: HomeLinks;
  now: Date;
  /** The check being read. Null shows the list only on a phone. */
  openId: string | null;
  /** Question card opened inside the check being read. */
  openQuestion: string | null;
  running: RunProgress | null;
  busy: 'starting' | 'stopping' | 'suggesting' | null;
  note: ChecksNote;
  onOpenCheck?: (id: string) => void;
  onBack?: () => void;
  onOpenQuestion?: (id: string) => void;
  onStart?: () => void;
  onStop?: () => void;
  onSuggest?: (findingId: string) => void;
  onRetry?: () => void;
};

const noteKey = { stopped: 'stopped', startFailed: 'startFailed', stopFailed: 'stopFailed', suggested: 'suggested', suggestFailed: 'suggestFailed' } as const;

/** The checks screen. Plain props in, markup out, so the same view renders signed in and in tests. */
export function ChecksView(props: ChecksViewProps) {
  const { lang, seat, phase, checks, access, running, busy, note, openId, openQuestion, links, now } = props;
  const copy = messagesFor(lang);
  const text = copy.checksScreen;
  const who = whoFor(props.person, seat, copy, phase === 'loading');
  const attrs = localeAttrs(lang);
  const open = checks.find((item) => item.id === openId) ?? null;
  const showCheck = open ?? (checks[0] ?? null);
  const view = open ? 'check' : 'list';
  return (
    <main className="nz-shell nz-checks" {...attrs} data-seat={seat} data-state={phase} data-view={view}>
      <div className="nz-shell-desk">
        <header className="nz-shell-head">
          <div className="nz-shell-who">
            <Avatar initials={who.initials} label={who.full} />
            <p className="nz-shell-greet"><strong>{who.name}</strong><small>{helpLine(props.assistant, copy, phase === 'loading')}</small></p>
          </div>
          <Bell label={copy.shell.alerts} empty={copy.shell.noAlerts} />
        </header>
        <div className="nz-shell-stack">
          {phase !== 'ready' ? <>
            <PhaseCard phase={phase === 'error' ? 'error' : 'loading'} copy={copy} onRetry={props.onRetry} fallback={links.home} />
          </> : <>
            <div className="nz-checks-head"><Heading light={text.light} bold={text.bold} lang={lang} flow="inline" /></div>
            {note === 'limit' ? <StateCard kind="limit" title={copy.shell.limitTitle} /> : null}
            {note === 'unreachable' ? <StateCard kind="offline" title={copy.shell.offlineTitle} action={access.start ? { label: copy.shell.retry, onClick: props.onStart } : null} /> : null}
            {seat === 'viewer' ? <StateCard kind="view" title={copy.shell.viewOnly} /> : null}
            {note && note !== 'limit' && note !== 'unreachable' ? <p className="nz-note-line" role="status" data-note={note}>{text[noteKey[note]]}</p> : null}
            <div className="nz-checks-body">
              <div className="nz-checks-list">
                {running ? <RunningCard lang={lang} running={running} canStop={access.stop} stopping={busy === 'stopping'} onStop={props.onStop} /> : null}
                {checks.length === 0 && !running ? <StateCard kind="empty" title={copy.shell.emptyTitle} action={access.start ? { label: busy === 'starting' ? text.starting : copy.shell.startCheck, onClick: busy === 'starting' ? undefined : props.onStart } : null} /> : null}
                {checks.map((item) => {
                  const clean = item.toFix === 0;
                  return (
                    <button key={item.id} type="button" className="nz-check-card" data-check={item.kind} data-clean={clean} aria-pressed={showCheck?.id === item.id} onClick={() => props.onOpenCheck?.(item.id)}>
                      <span className={clean ? 'nz-check-mark nz-check-mark-right' : 'nz-check-mark nz-check-mark-wrong'}><ShellIcon name={clean ? 'check' : 'dot'} /></span>
                      <span className="nz-check-text">
                        <strong>{kindLabel(item.kind, copy)}{lang === 'ar' ? '، ' : ', '}{dayLabel(item.at, now, lang, copy)}</strong>
                        <small className={clean ? 'nz-check-right' : 'nz-check-wrong'}>{resultLabel(item.toFix, copy)}</small>
                      </span>
                      <span className="nz-check-go"><ShellIcon name="play" directional /></span>
                    </button>
                  );
                })}
                {access.start && checks.length > 0 && !running ? <PillButton className="nz-checks-start" icon="play" directional label={busy === 'starting' ? text.starting : copy.shell.startCheck} disabled={busy === 'starting'} onClick={props.onStart} /> : null}
              </div>
              {showCheck ? <CheckDetail lang={lang} check={showCheck} now={now} access={access} openQuestion={openQuestion} busy={busy} links={links} onBack={props.onBack} onOpenQuestion={props.onOpenQuestion} onSuggest={props.onSuggest} /> : null}
            </div>
          </>}
        </div>
      </div>
      <FloatingBottomNav lang={lang} seat={seat} copy={copy} canStart={access.start} current="checks" links={navLinks(links, seat)} />
      <SideNav lang={lang} seat={seat} copy={copy} canStart={access.start} current="checks" links={navLinks(links, seat)} />
    </main>
  );
}

function navLinks(go: HomeLinks, seat: Seat) {
  // A viewer cannot read History, so More opens Settings for them.
  return { home: go.home, checks: go.checks, start: go.start, fixes: go.fixes, more: seat === 'viewer' ? go.settings : go.more };
}

function RunningCard({ lang, running, canStop, stopping, onStop }: { lang: Lang; running: RunProgress; canStop: boolean; stopping: boolean; onStop?: () => void }) {
  const copy = messagesFor(lang);
  const text = copy.checksScreen;
  const percent = progressPercent(running.done, running.total);
  return (
    <section className="nz-running" aria-label={text.checkingNow} data-running="true">
      <div className="nz-running-top">
        <p className="nz-running-title"><span className="nz-live-dot" aria-hidden="true" /><strong>{text.checkingNow}</strong></p>
        {canStop ? <button type="button" className="nz-quiet-btn" disabled={stopping} onClick={onStop}>{stopping ? text.stopping : text.stopCheck}</button> : null}
      </div>
      <div className="nz-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={progressLine(running.done, running.total, copy)}><span style={{ inlineSize: `${percent}%` }} /></div>
      <p className="nz-running-meta"><span>{progressLine(running.done, running.total, copy)}</span><em>{text.inProgress}</em></p>
    </section>
  );
}

const markLabel = (mark: Mark, lang: Lang) => {
  const text = messagesFor(lang).checksScreen;
  return mark === 'right' ? text.right : mark === 'wrong' ? text.wrong : text.unsure;
};

function CheckDetail({ lang, check, now, access, openQuestion, busy, links, onBack, onOpenQuestion, onSuggest }: {
  lang: Lang; check: CheckRow; now: Date; access: ChecksAccess; openQuestion: string | null; busy: ChecksViewProps['busy']; links: HomeLinks;
  onBack?: () => void; onOpenQuestion?: (id: string) => void; onSuggest?: (findingId: string) => void;
}) {
  const copy = messagesFor(lang);
  const text = copy.checksScreen;
  const opened = openQuestion === '' ? null : check.questions.some((item) => item.id === openQuestion) ? openQuestion : (check.questions.find((item) => item.mark === 'wrong') ?? check.questions[0])?.id ?? null;
  return (
    <section className="nz-check-page" aria-label={kindLabel(check.kind, copy)}>
      <button type="button" className="nz-back" onClick={onBack}><ShellIcon name="play" directional /><span>{text.back}</span></button>
      <Heading as="h2" light={kindLabel(check.kind, copy)} bold={resultLabel(check.toFix, copy)} lang={lang} flow="inline" />
      <p className="nz-check-sub">{dayLabel(check.at, now, lang, copy)}{lang === 'ar' ? '، ' : ', '}{fill(text.questionsCount, { n: String(check.questions.length) })}</p>
      <ul className="nz-questions">
        {check.questions.map((item) => {
          const isOpen = opened === item.id;
          return (
            <li key={item.id} className="nz-question" data-mark={item.mark} data-open={isOpen}>
              <button type="button" className="nz-question-head" aria-expanded={isOpen} onClick={() => onOpenQuestion?.(item.id)}>
                <span className="nz-question-text">{item.question}</span>
                <Chip kind={item.mark} label={markLabel(item.mark, lang)} />
              </button>
              {isOpen ? <div className="nz-question-body">
                <div className="nz-quote nz-quote-said"><p className="nz-quote-label">{text.said}</p><p>{item.said}</p></div>
                {item.record ? <div className="nz-quote nz-quote-record"><p className="nz-quote-label">{text.record}</p><p>{item.record}</p></div> : null}
                {access.suggest && item.mark === 'wrong' && item.findingId ? <PillButton variant="ink" icon="wrench" className="nz-suggest" label={busy === 'suggesting' ? text.suggesting : text.suggest} disabled={busy === 'suggesting'} onClick={() => onSuggest?.(item.findingId!)} /> : null}
              </div> : null}
            </li>
          );
        })}
      </ul>
      {check.toFix > 0 && !access.suggest ? <PillButton className="nz-checks-start" icon="pencil" label={copy.shell.fixes} href={links.fixes} /> : null}
    </section>
  );
}
