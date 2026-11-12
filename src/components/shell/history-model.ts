import { fill, type Lang, type Messages } from '@/components/ocean/copy';
import { can, type Role } from '@/server/auth/roles';
import { isCompleteReport, stoppedLine, type ReportBody } from '@/server/reports/build';
import { daysBetween } from './home-model';
import type { StoredFix } from './fixes-model';

export type HistoryKind = 'checkDone' | 'checkStopped' | 'suggested' | 'approved' | 'turnedDown';

export type HistoryItem = {
  id: string;
  kind: HistoryKind;
  /** Null for a finished check, which no one person owns. */
  who: { name: string; initials: string } | null;
  /** Second line: a fix title or the question count. */
  detail: string;
  at: Date;
};

export type HistoryGroups = { today: HistoryItem[]; yesterday: HistoryItem[]; earlier: HistoryItem[] };

/** History follows audit.read on the server: owner, fixer and reviewer. The viewer does not see it. */
export function historyAccess(roles: readonly string[]): boolean {
  return can(roles as Role[], 'audit.read');
}

type Saved = { created_at: string; body: ReportBody };

/** Plain sentences from saved checks and from fixes kept on this device. No ids, no codes. */
export function buildHistory(reports: readonly (Saved & { id: string })[], fixes: readonly StoredFix[], lang: Lang, copy: Messages): HistoryItem[] {
  const text = copy.historyScreen;
  const items: HistoryItem[] = [];
  for (const report of reports) {
    const at = new Date(report.created_at);
    if (Number.isNaN(at.getTime())) continue;
    items.push({ id: `r-${report.id}`, kind: isCompleteReport(report.body) ? 'checkDone' : 'checkStopped', who: null, detail: isCompleteReport(report.body) ? fill(text.questions, { n: String(report.body.counts.conversations) }) : stoppedLine(report.body, lang), at });
  }
  for (const fix of fixes) {
    const title = lang === 'ar' ? fix.title.ar : fix.title.en;
    const made = fix.at ? new Date(fix.at) : null;
    if (made && !Number.isNaN(made.getTime())) items.push({ id: `s-${fix.id}`, kind: 'suggested', who: { name: fix.by.name, initials: fix.by.initials }, detail: title, at: made });
    const decided = fix.decided ? new Date(fix.decided.at) : null;
    if (fix.decided && decided && !Number.isNaN(decided.getTime())) items.push({ id: `d-${fix.id}`, kind: fix.decided.status, who: { name: fix.decided.name, initials: fix.decided.initials }, detail: title, at: decided });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function sentenceFor(item: HistoryItem, copy: Messages): string {
  const text = copy.historyScreen;
  if (item.kind === 'checkDone') return text.checkDone;
  if (item.kind === 'checkStopped') return text.checkStopped;
  return fill(text[item.kind], { name: item.who?.name ?? '' });
}

export function groupByDay(items: readonly HistoryItem[], now: Date): HistoryGroups {
  const groups: HistoryGroups = { today: [], yesterday: [], earlier: [] };
  for (const item of items) {
    const days = daysBetween(item.at, now);
    (days === 0 ? groups.today : days === 1 ? groups.yesterday : groups.earlier).push(item);
  }
  return groups;
}

/** The clock time in Dubai, 24 hour, Western digits in both languages. */
export function clockText(at: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

/** Short day for older rows, for example 3 Nov. */
export function dayText(at: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short' }).format(at);
}
