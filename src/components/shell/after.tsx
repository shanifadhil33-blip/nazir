import Link from 'next/link';
import { Heading } from '@/components/heading';
import { BackLink } from './back-link';
import { fill, messagesFor, type Lang } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { Avatar } from './avatar';
import { DemoBar } from './demo-bar';
import { Bell } from './bell';
import type { ReportBody } from '@/server/reports/build';
import { changedQuestions, changeBetween, languageLine, type Change, type ServerFix } from './fixes-model';
import { navLinks } from './fixes';
import { FloatingBottomNav } from './floating-nav';
import type { HomeLinks } from './home-model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { helpLine, whoFor } from './people';
import { SideNav } from './side-nav';
import { PhaseCard, StateCard } from './state-card';

export type AfterViewProps = {
  lang: Lang;
  seat: Seat;
  phase: 'loading' | 'ready' | 'error';
  /** The fix from ?fix=. Without one, the newest tested fix is shown. */
  fixId: string | null;
  fixes: readonly ServerFix[];
  reports: readonly { id: string; body: ReportBody }[];
  canStart: boolean;
  assistant: string;
  person?: { initials: string; name: string };
  links: HomeLinks;
  onRetry?: () => void;
  /** Preview pages pass a made up comparison instead of saved checks. */
  sample?: FixCompare | null;
};

/** Thu 09:04, in Dubai time, the same on the server and the phone. */
export function whenLabel(at: string | null | undefined, lang: Lang) {
  if (!at) return '';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at));
}

export type FixCompare = { title: string; change: Change; before: { right: number; total: number; at: string }; after: { right: number; total: number; at: string }; sample: boolean; beforeId?: string; afterId?: string; questions?: ReturnType<typeof changedQuestions> };

/** The check the fix came from, next to the check that tested it again. Each fix compares only its own two checks. */
export function compareFix(fixId: string | null, fixes: readonly ServerFix[], reports: readonly { id: string; body: ReportBody }[], lang: Lang): FixCompare | null {
  const tested = fixes.filter((f) => f.retest_report_id && f.before_run_id);
  const fix = fixId ? tested.find((f) => f.id === fixId) : tested[0];
  if (!fix) return null;
  const beforeReport = reports.find((r) => r.body.run.id === fix.before_run_id);
  const before = beforeReport?.body;
  const after = reports.find((r) => r.id === fix.retest_report_id)?.body;
  if (!before || !after) return null;
  const change = changeBetween(before, after);
  const count = (b: ReportBody) => ({ right: b.counts.passed, total: b.counts.conversations, at: whenLabel(b.run.finished_at ?? b.run.started_at, lang) });
  const title = (lang === 'ar' ? fix.finding_title_ar || fix.finding_title : fix.finding_title) || (lang === 'ar' ? fix.title_ar : fix.title);
  return { title, change, before: count(before), after: count(after), sample: Boolean(before.sample || after.sample), beforeId: beforeReport!.id, afterId: fix.retest_report_id!, questions: changedQuestions(before, after) };
}

/** Before and after one fix. Plain props in, markup out. */
export function AfterView({ lang, seat, phase, fixId, fixes, reports, canStart, assistant, person, links, onRetry, sample }: AfterViewProps) {
  const copy = messagesFor(lang);
  const text = copy.afterScreen;
  const who = whoFor(person, seat, copy, phase === 'loading');
  const compared = sample !== undefined ? sample : compareFix(fixId, fixes, reports, lang);
  const change = compared?.change ?? null;
  const rows = change ? [
    { id: 'fixed', label: text.fixed, n: change.fixed, tone: 'right', icon: 'tick' },
    { id: 'still', label: text.stillWrong, n: change.stillWrong, tone: 'wrong', icon: 'cross' },
    { id: 'newly', label: text.newlyWrong, n: change.newlyWrong, tone: 'none', icon: 'ring' },
  ] as const : [];
  const checkHref = (id: string) => `${links.checks}&check=${id}&lang=${lang}`;
  const line = change ? languageLine(change, copy) : '';
  return (
    <main className="nz-shell nz-after" {...localeAttrs(lang)} data-seat={seat} data-state={phase}>
      <div className="nz-shell-desk">
        <header className="nz-shell-head">
          <div className="nz-shell-who">
            <Link href={links.settings} aria-label={copy.shell.settings}><Avatar initials={who.initials} label={who.full} /></Link>
            <p className="nz-shell-greet"><strong>{who.name}</strong><small>{helpLine(assistant, copy, phase === 'loading')}</small></p>
          </div>
          <Bell lang={lang} home={links.home} />
        </header>
        <DemoBar lang={lang} />
        <div className="nz-shell-stack">
          <BackLink href={links.fixes} label={copy.shell.fixes} />
          {phase !== 'ready' ? <>
            <PhaseCard phase={phase === 'error' ? 'error' : 'loading'} copy={copy} onRetry={onRetry} fallback={links.home} />
          </> : <>
            <Heading light={text.light} bold={text.bold} lang={lang} flow="inline" />
            {seat === 'viewer' ? <StateCard kind="view" title={copy.shell.viewOnly} /> : null}
            {compared && change ? <>
              <p className="nz-after-title"><strong dir="auto">{compared.title}</strong></p>
              <p className="nz-check-sub">{text.intro}</p>
              {change.unsure ? <p className="nz-check-sub">{fill(text.unknown, { n: String(change.unsure), total: String(change.total) })}</p> : null}
              {compared.sample ? <p className="nz-check-sub">{text.sample}</p> : null}
              <ul className="nz-after-sides">
                <li className="nz-after-side" data-side="before"><Link href={compared.beforeId ? checkHref(compared.beforeId) : links.checks}><span>{text.beforeAt}</span><strong>{fill(text.ofRight, { n: String(compared.before.right), total: String(compared.before.total) })}</strong><small>{compared.before.at}</small></Link></li>
                <li className="nz-after-side" data-side="after"><Link href={compared.afterId ? checkHref(compared.afterId) : links.checks}><span>{text.afterAt}</span><strong>{fill(text.ofRight, { n: String(compared.after.right), total: String(compared.after.total) })}</strong><small>{compared.after.at}</small></Link></li>
              </ul>
              <ul className="nz-after-rows">
                {rows.map((row) => (
                  <li key={row.id} className="nz-after-row" data-row={row.id}><Link href={compared.afterId ? `${checkHref(compared.afterId)}&change=${row.id}&from=${compared.beforeId}` : links.checks}>
                    <span className={`nz-after-ico nz-after-ico-${row.tone}`} aria-hidden="true"><ShellIcon name={row.icon === 'tick' ? 'tick' : row.icon === 'cross' ? 'cross' : 'ring'} /></span>
                    <span>{row.label} {row.n}</span></Link>
                  </li>
                ))}
              </ul>
              {line ? <p className="nz-after-lang">{line}</p> : null}
            </> : <StateCard kind="empty" title={text.emptyTitle} action={{ label: text.goChecks, href: links.fixes }} />}
          </>}
        </div>
      </div>
      <FloatingBottomNav lang={lang} seat={seat} copy={copy} canStart={canStart} current="fixes" links={navLinks(links, seat)} />
      <SideNav lang={lang} seat={seat} copy={copy} canStart={canStart} current="fixes" links={navLinks(links, seat)} />
    </main>
  );
}
