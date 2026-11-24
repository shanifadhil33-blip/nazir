'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Heading } from '@/components/heading';
import { BackLink } from './back-link';
import { ConfirmButton } from './confirm-button';
import { fill, messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { Avatar } from './avatar';
import { DemoBar } from './demo-bar';
import { Bell } from './bell';
import { Chip } from './chip';
import { paneScroll, type CheckPane } from './checks-scroll';
import { checkResultLabel, countsLine, dateTimeLabel, progressLine, progressPercent, type CheckFilter, type CheckRow, type ChecksAccess, type Mark } from './checks-model';
import type { RunProgress } from './checks-run';
import { FloatingBottomNav } from './floating-nav';
import type { HomeLinks } from './home-model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { helpLine, whoFor } from './people';
import { PillButton } from './pill-button';
import { SideNav } from './side-nav';
import { PhaseCard, StateCard } from './state-card';

export type ChecksNote = 'limit' | 'busy' | 'unreachable' | 'startFailed' | 'stopFailed' | 'suggested' | 'suggestFailed' | null;

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
  active?: RunProgress[];
  activeStatus?: 'loading' | 'ready' | 'error';
  busy: 'starting' | 'stopping' | 'suggesting' | null;
  note: ChecksNote;
  limitReset?: string;
  connectionReady?: boolean;
  onOpenCheck?: (id: string) => void;
  onBack?: () => void;
  onOpenQuestion?: (id: string) => void;
  onStart?: () => void;
  onStop?: (runId?: string) => void | Promise<boolean | undefined>;
  onSuggest?: (findingId: string) => void;
  /** Wrong answers that already have a fix, by finding. One fix per wrong answer. */
  fixFor?: Record<string, string>;
  onRetry?: () => void;
  /** Answers (quality checks) or Safety (safety tests). */
  tab?: 'answers' | 'safety';
  onTab?: (tab: 'answers' | 'safety') => void;
  /** The Safety tab body, and whether one safety test is open (phone shows it alone). */
  safety?: ReactNode;
  safetyOpen?: boolean;
  /** Start asks: Check answers or Test safety. */
  choosing?: boolean;
  onChoose?: (what: 'answers' | 'safety' | null) => void;
  /** Which answers the open check shows. */
  questionIds?: string[];
  filter?: CheckFilter;
  onFilter?: (filter: CheckFilter) => void;
  /** The saved report for one check. */
  reportHref?: (checkId: string) => string;
};

const noteKey = { busy: 'busy', startFailed: 'startFailed', stopFailed: 'stopFailed', suggested: 'suggested', suggestFailed: 'suggestFailed' } as const;

/** The checks screen. Plain props in, markup out, so the same view renders signed in and in tests. */
export function ChecksView(props: ChecksViewProps) {
  const { lang, seat, phase, checks, access, running, busy, note, openId, openQuestion, links } = props;
  const copy = messagesFor(lang);
  const text = copy.checksScreen;
  const who = whoFor(props.person, seat, copy, phase === 'loading');
  const attrs = localeAttrs(lang);
  const open = checks.find((item) => item.id === openId) ?? null;
  const showCheck = open ?? (checks[0] ?? null);
  const tab = props.tab ?? 'answers';
  const view = tab === 'safety' ? (props.safetyOpen ? 'check' : 'list') : open ? 'check' : 'list';
  const paneRef = useCheckPaneScroll(view);
  const safetyText = copy.safetyScreen;
  const active = props.active ?? (running ? [running] : []);
  const canStart = access.start && (props.activeStatus ?? 'ready') === 'ready' && active.length === 0;
  const times = new Map(checks.map((item) => [item.id, dateTimeLabel(item.at, lang)]));
  const frequencies = new Map<string, number>();
  for (const label of times.values()) frequencies.set(label, (frequencies.get(label) ?? 0) + 1);
  const when = (item: CheckRow) => dateTimeLabel(item.at, lang, (frequencies.get(times.get(item.id)!) ?? 0) > 1);
  return (
    <main ref={paneRef} className="nz-shell nz-checks" {...attrs} data-seat={seat} data-state={phase} data-view={view}>
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
          {view === 'list' ? <BackLink href={links.home} label={copy.shell.home} /> : null}
          {phase !== 'ready' ? <>
            <PhaseCard phase={phase === 'error' ? 'error' : 'loading'} copy={copy} onRetry={props.onRetry} fallback={links.home} />
          </> : <>
            <div className="nz-checks-head">
              <div><Heading light={text.light} bold={text.bold} lang={lang} flow="inline" explain={text.explain} /></div>
              {props.onTab ? <div className="nz-tabs" role="tablist" aria-label={copy.shell.checks}>
                {(['answers', 'safety'] as const).map((id) => <button key={id} type="button" role="tab" className="nz-tab" aria-selected={tab === id} data-tab={id} onClick={() => props.onTab?.(id)}>{id === 'answers' ? safetyText.answers : safetyText.safety}</button>)}
              </div> : null}
            </div>
            {props.choosing ? <section className="nz-start-choice" aria-label={safetyText.chooseTitle}>
              <h2>{safetyText.chooseTitle}</h2>
              <button type="button" className="nz-check-card" data-choice="answers" onClick={() => props.onChoose?.('answers')}>
                <span className="nz-check-mark nz-check-mark-right"><ShellIcon name="checks" /></span>
                <span className="nz-check-text"><strong>{safetyText.checkAnswers}</strong><small>{safetyText.checkAnswersNote}</small></span>
                <span className="nz-check-go"><ShellIcon name="play" directional /></span>
              </button>
              <button type="button" className="nz-check-card" data-choice="safety" onClick={() => props.onChoose?.('safety')}>
                <span className="nz-check-mark nz-check-mark-wrong"><ShellIcon name="check" /></span>
                <span className="nz-check-text"><strong>{safetyText.testSafety}</strong><small>{safetyText.testSafetyNote}</small></span>
                <span className="nz-check-go"><ShellIcon name="play" directional /></span>
              </button>
              <button type="button" className="nz-quiet-btn" onClick={() => props.onChoose?.(null)}>{copy.fixesScreen.notNow}</button>
            </section> : null}
            {note === 'limit' ? <StateCard kind="limit" title={props.limitReset && Number.isFinite(Date.parse(props.limitReset)) ? fill(text.limitAt, { time: new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(props.limitReset)) }) : copy.shell.limitTitle} /> : null}
            {note === 'unreachable' ? <StateCard kind="offline" title={copy.shell.offlineTitle} action={{ label: text.checkConnection, href: `${links.home}?connect=quick&lang=${lang}` }} /> : null}
            {seat === 'viewer' ? <StateCard kind="view" title={copy.shell.viewOnly} /> : null}
            {note && note !== 'limit' && note !== 'unreachable' ? <p className="nz-note-line" role="status" data-note={note}>{text[noteKey[note]]}</p> : null}
            {tab === 'safety' ? props.safety : <div className="nz-checks-body">
              <div className="nz-checks-list">
                {active.map((run) => <RunningCard key={run.runId} lang={lang} running={run} canStop={access.stop} stopping={busy === 'stopping'} onStop={() => props.onStop?.(run.runId)} />)}
                {props.activeStatus && props.activeStatus !== 'ready' ? <PhaseCard phase={props.activeStatus} copy={copy} onRetry={props.onRetry} fallback={links.home} /> : null}
                {checks.length === 0 && active.length === 0 && (props.activeStatus ?? 'ready') === 'ready' ? <StateCard kind="empty" title={props.connectionReady === false ? text.emptyConnect : text.empty} action={props.connectionReady === false ? { label: copy.connect.title, href: `${links.home}?connect=quick&lang=${lang}` } : canStart ? { label: busy === 'starting' ? text.starting : copy.shell.startCheck, onClick: busy === 'starting' ? undefined : props.onStart } : null} /> : null}
                {checks.map((item) => {
                  const clean = !item.stopped && item.questions.length > 0 && item.questions.every((q) => q.mark === 'right');
                  const tone = clean ? 'right' : item.toFix > 0 ? 'wrong' : 'unsure';
                  return (
                    <button key={item.id} type="button" className="nz-check-card" data-check={item.kind} data-check-id={item.id} data-clean={clean} aria-pressed={showCheck?.id === item.id} onClick={() => props.onOpenCheck?.(item.id)}>
                      <span className={`nz-check-mark nz-check-mark-${tone}`}><ShellIcon name={clean ? 'check' : 'dot'} /></span>
                      <span className="nz-check-text">
                        <strong>{fill(text.checkTitle, { when: when(item) })}</strong>
                        {item.sample ? <small>{copy.shell.sample}</small> : null}
                        <small className={`nz-check-${tone}`}>{checkResultLabel(item, copy)}</small>
                      </span>
                      <span className="nz-check-go"><ShellIcon name="play" directional /></span>
                    </button>
                  );
                })}
                {canStart && checks.length > 0 ? <PillButton className="nz-checks-start" icon="play" directional label={busy === 'starting' ? text.starting : copy.shell.startCheck} disabled={busy === 'starting'} onClick={props.onStart} /> : null}
              </div>
              {showCheck ? <CheckDetail lang={lang} check={showCheck} when={when(showCheck)} access={access} openQuestion={openQuestion} busy={busy} links={links} onBack={open ? props.onBack : undefined} onOpenQuestion={props.onOpenQuestion} onSuggest={props.onSuggest} fixFor={props.fixFor ?? {}} questionIds={props.questionIds} filter={props.filter ?? 'all'} onFilter={props.onFilter} reportHref={props.reportHref?.(showCheck.id)} /> : null}
            </div>}
          </>}
        </div>
      </div>
      <FloatingBottomNav lang={lang} seat={seat} copy={copy} canStart={canStart} current="checks" links={navLinks(links, seat)} />
      <SideNav lang={lang} seat={seat} copy={copy} canStart={canStart} current="checks" links={navLinks(links, seat)} />
    </main>
  );
}

function useCheckPaneScroll(view: CheckPane) {
  const rootRef = useRef<HTMLElement>(null);
  const saved = useRef(0);
  const previous = useRef(view);
  const opened = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Read the list scroll before React hides it. Hiding the list clamps the window to 0.
    const remember = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.nz-check-card')) return;
      if (previous.current !== 'list' || !window.matchMedia('(max-width: 1023px)').matches) return;
      saved.current = window.scrollY;
    };
    root.addEventListener('click', remember, true);
    return () => root.removeEventListener('click', remember, true);
  }, []);
  useLayoutEffect(() => {
    const phone = window.matchMedia('(max-width: 1023px)').matches;
    const before = previous.current;
    previous.current = view;
    const plan = paneScroll(before, view, phone, saved.current, saved.current);
    if (!plan) return;
    if (view === 'check') {
      const current = document.activeElement;
      opened.current = current instanceof HTMLElement && current.classList.contains('nz-check-card') ? current : null;
      document.querySelector<HTMLElement>('.nz-check-page .nz-back')?.focus({ preventScroll: true });
    } else {
      opened.current?.focus({ preventScroll: true });
    }
    window.scrollTo(0, plan.top);
  }, [view]);
  return rootRef;
}

function navLinks(go: HomeLinks, seat: Seat) {
  // A viewer cannot read History, so More opens Settings for them.
  return { settings: go.settings, home: go.home, checks: go.checks, start: go.start, fixes: go.fixes, more: seat === 'viewer' ? go.settings : go.more };
}

function RunningCard({ lang, running, canStop, stopping, onStop }: { lang: Lang; running: RunProgress; canStop: boolean; stopping: boolean; onStop?: () => void | Promise<boolean | undefined> }) {
  const copy = messagesFor(lang);
  const text = copy.checksScreen;
  const percent = progressPercent(running.done, running.total);
  return (
    <section className="nz-running" aria-label={text.checkingNow} data-running="true">
      <div className="nz-running-top">
        <p className="nz-running-title"><span className="nz-live-dot" aria-hidden="true" /><strong>{progressLine(running.done, running.total, copy)}</strong></p>
        {canStop ? <ConfirmButton lang={lang} label={stopping ? text.stopping : text.stopCheck} title={text.stopTitle} note={text.stopNote} failed={text.stopFailed} disabled={stopping} onConfirm={onStop} /> : null}
      </div>
      <div className="nz-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={progressLine(running.done, running.total, copy)}><span style={{ inlineSize: `${percent}%` }} /></div>
    </section>
  );
}

const markLabel = (mark: Mark, lang: Lang) => {
  const text = messagesFor(lang).checksScreen;
  return mark === 'notChecked' ? text.notChecked : mark === 'right' ? text.right : mark === 'wrong' ? text.wrong : text.unsure;
};

function CheckDetail({ lang, check, when, access, openQuestion, busy, links, onBack, onOpenQuestion, onSuggest, fixFor, questionIds, filter, onFilter, reportHref }: {
  lang: Lang; check: CheckRow; when: string; access: ChecksAccess; openQuestion: string | null; busy: ChecksViewProps['busy']; links: HomeLinks;
  onBack?: () => void; onOpenQuestion?: (id: string) => void; onSuggest?: (findingId: string) => void; fixFor: Record<string, string>;
  questionIds?: string[]; filter: CheckFilter; onFilter?: (filter: CheckFilter) => void; reportHref?: string;
}) {
  const copy = messagesFor(lang);
  const text = copy.checksScreen;
  const shown = check.questions.filter((item) => (filter === 'all' || item.mark === filter) && (!questionIds || questionIds.includes(item.id)));
  const opened = shown.some((item) => item.id === openQuestion) ? openQuestion : null;
  return (
    <section className="nz-check-page" aria-label={fill(text.checkTitle, { when })}>
      {onBack ? <button type="button" className="nz-back" onClick={onBack}><ShellIcon name="play" directional /><span>{text.back}</span></button> : null}
      <Heading as="h2" light={fill(text.checkTitle, { when })} bold={countsLine(check, copy)} lang={lang} flow="stack" explain={text.detailExplain} />
      {check.sample ? <p className="nz-check-sub">{copy.shell.sample}</p> : null}
      <div className="nz-tabs nz-check-filter" role="group" aria-label={text.filterAll}>
        {(['all', 'wrong', 'right', ...(check.questions.some((q) => q.mark === 'unsure') ? ['unsure' as const] : [])] as const).map((id) => <button key={id} type="button" className="nz-tab" data-filter={id} aria-pressed={filter === id} onClick={() => onFilter?.(id)}>{id === 'all' ? text.filterAll : id === 'wrong' ? text.filterWrong : id === 'right' ? text.filterRight : text.unsure}</button>)}
      </div>
      {shown.length === 0 ? <p className="nz-check-sub">{text.noneHere}</p> : null}
      <ul className="nz-questions">
        {shown.map((item) => {
          const isOpen = opened === item.id;
          return (
            <li key={item.id} className="nz-question" data-mark={item.mark} data-open={isOpen}>
              <button type="button" className="nz-question-head" aria-expanded={isOpen} onClick={() => onOpenQuestion?.(item.id)}>
                <span className="nz-question-text" dir="auto">{item.question}</span>
                <Chip kind={item.mark === 'notChecked' ? 'unsure' : item.mark} label={markLabel(item.mark, lang)} />
              </button>
              {isOpen ? <div className="nz-question-body">
                <div className="nz-quote nz-quote-said"><p className="nz-quote-label">{text.said}</p><p dir="auto">{item.said}</p></div>
                {item.record ? <div className="nz-quote nz-quote-record"><p className="nz-quote-label">{text.record}</p><p dir="auto">{item.record}</p></div> : null}
                {item.mark === 'wrong' && item.why ? <div className="nz-quote"><p className="nz-quote-label">{text.whyWrong}</p><p dir="auto">{item.why}</p></div> : null}
                {item.mark === 'unsure' ? <p className="nz-check-sub">{check.repliesOnly ? text.unknownReply : text.unknownReason}</p> : null}
                {item.mark === 'unsure' && check.repliesOnly ? <Link className="nz-text-link" href={`${links.home}?connect=full&lang=${lang}`}>{copy.agentStatus.addSdk}</Link> : null}
                {item.mark === 'wrong' && item.findingId && fixFor[item.findingId]
                  ? <PillButton icon="wrench" className="nz-suggest nz-suggested" label={text.fixSuggested} href={`${links.fixes}&fix=${fixFor[item.findingId]}`} />
                  : access.suggest && item.mark === 'wrong' && item.findingId ? <PillButton variant="ink" icon="wrench" className="nz-suggest" label={busy === 'suggesting' ? text.suggesting : text.suggest} disabled={busy === 'suggesting'} onClick={() => onSuggest?.(item.findingId!)} /> : null}
              </div> : null}
            </li>
          );
        })}
      </ul>
      {check.toFix > 0 && !access.suggest ? <PillButton className="nz-checks-start" icon="pencil" label={copy.shell.fixes} href={links.fixes} /> : null}
      {reportHref ? <PillButton className="nz-see-report" icon="pencil" label={text.seeReport} href={reportHref} /> : null}
    </section>
  );
}
