import { fill, type Lang, type Messages } from '@/components/ocean/copy';
import { canApprove, canRunRecheck } from '@/components/ocean/model';
import { presentRecord } from '@/components/ocean/plain';
import { can, type Role } from '@/server/auth/roles';
import { isCompleteReport, caseResults, type ReportBody } from '@/server/reports/build';

export type FixStatus = 'waiting' | 'approved' | 'turnedDown';
export type Tab = 'waiting' | 'done';

/** One suggested fix, as kept on this device after the server accepted it. */
export type StoredFix = {
  id: string;
  findingId: string;
  status: FixStatus;
  by: { name: string; initials: string; mine: boolean };
  title: { en: string; ar: string };
  /** Questions the server picked to check again. Known only after approval. */
  recheck: number | null;
  /** True once the check again was started. */
  rerun: boolean;
  /** When this device saw the suggestion, and who decided it and when. Used by History. */
  at?: string;
  decided?: { at: string; name: string; initials: string; status: 'approved' | 'turnedDown' };
};

/** Where a fix is in its life, read from the server list every device shares. */
export type Retest = { state: 'none' | 'running' | 'done' | 'stopped'; done: number; total: number };

export type FixCard = {
  id: string;
  findingId: string;
  status: FixStatus;
  title: string;
  by: { name: string; initials: string; mine: boolean };
  wrong: string;
  /** Built in sample: what the fix changes. Your own agent: the instruction change to copy. */
  fix: string;
  ownAgent: boolean;
  retest: Retest;
  /** Before and after for this fix, once its test again has a saved check. */
  change: Change | null;
};

export type FixesAccess = { decide: boolean; recheck: boolean };

/** Approve and Turn down follow proposal.decide, Check again follows plan.approve. The server checks again. */
export function fixesAccess(roles: readonly string[]): FixesAccess {
  return { decide: canApprove(roles), recheck: canRunRecheck(roles) };
}

export function canSuggest(roles: readonly string[]) {
  return can(roles as Role[], 'proposal.create');
}

/** One suggested fix as the proposals route returns it. */
export type ServerFix = {
  id: string; finding_id: string; status: string; title: string; title_ar: string; created_at: string;
  proposed_by_name: string | null; decided_at: string | null; decided_by_name: string | null;
  mine?: boolean; own_agent?: boolean; instruction?: { en: string; ar: string } | null; expected_benefit?: string | null;
  finding_title?: string | null; finding_title_ar?: string | null; finding_language?: string | null; before_run_id?: string | null;
  retest_run_id?: string | null; retest_run_status?: string | null; retest_done?: number | null; retest_total?: number | null; retest_report_id?: string | null;
};
const firstName = (name: string | null) => (name ?? '').trim().split(/\s+/)[0] ?? '';
const initialsFor = (name: string | null) => (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0] ?? '').join('').toUpperCase();

/**
 * The server list is the truth, so every person and every device sees the same fixes.
 * What only this device knows (the questions chosen to check again, and whether that was started) is kept from the local copy.
 * A fix saved here a moment ago that the list does not have yet stays.
 */
export function mergeServerFixes(local: StoredFix[], server: readonly ServerFix[]): StoredFix[] {
  const known = new Map(local.map((item) => [item.id, item]));
  const merged = server.map((row): StoredFix => {
    const kept = known.get(row.id);
    const status: FixStatus = row.status === 'approved' ? 'approved' : row.status === 'rejected' ? 'turnedDown' : 'waiting';
    const by = { name: firstName(row.proposed_by_name), initials: initialsFor(row.proposed_by_name), mine: false };
    const decided = status !== 'waiting' && row.decided_at ? { at: row.decided_at, name: firstName(row.decided_by_name), initials: initialsFor(row.decided_by_name), status: status as 'approved' | 'turnedDown' } : undefined;
    return { id: row.id, findingId: row.finding_id, status, by, title: { en: row.title, ar: row.title_ar }, recheck: kept?.recheck ?? null, rerun: kept?.rerun ?? false, at: row.created_at, ...(decided ? { decided } : {}) };
  });
  const serverIds = new Set(server.map((row) => row.id));
  return [...merged, ...local.filter((item) => !serverIds.has(item.id))].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());
}

export function retestOf(row: ServerFix): Retest {
  const done = Number(row.retest_done ?? 0), total = Number(row.retest_total ?? 0);
  if (!row.retest_run_id) return { state: 'none', done, total };
  if (row.retest_run_status === 'queued' || row.retest_run_status === 'running') return { state: 'running', done, total };
  if (row.retest_run_status === 'cancelled') return { state: 'stopped', done, total };
  return row.retest_report_id ? { state: 'done', done, total } : { state: 'running', done, total };
}

/** Server fixes plus the saved checks become cards. Plain words only, nothing kept on the device. */
export function fixCards(server: readonly ServerFix[], reports: readonly { id: string; body: ReportBody }[], lang: Lang, copy: Messages): FixCard[] {
  return server.filter((row) => ['proposed', 'approved', 'rejected'].includes(row.status)).map((row) => {
    // A fix can belong to an earlier check, so every saved check is searched, newest first.
    const body = reports.find((r) => r.body.findings.some((f) => f.id === row.finding_id))?.body ?? null;
    const finding = body?.findings.find((f) => f.id === row.finding_id);
    const record = finding ? presentRecord(finding.really_happened, finding.really_happened_ar) : null;
    const baseTitle = (lang === 'ar' ? row.finding_title_ar || row.finding_title : row.finding_title) || (lang === 'ar' ? row.title_ar : row.title);
    const language = row.finding_language === 'ar' ? copy.fixesScreen.inArabic : row.finding_language === 'en' ? copy.fixesScreen.inEnglish : '';
    const status: FixStatus = row.status === 'approved' ? 'approved' : row.status === 'rejected' ? 'turnedDown' : 'waiting';
    const retest = retestOf(row);
    const before = reports.find((r) => r.body.run.id === row.before_run_id)?.body;
    const after = row.retest_report_id ? reports.find((r) => r.id === row.retest_report_id)?.body : undefined;
    const instruction = row.instruction ? (lang === 'ar' ? row.instruction.ar : row.instruction.en) : null;
    return {
      id: row.id, findingId: row.finding_id, status, title: `${baseTitle}${language}`,
      by: { name: firstName(row.proposed_by_name), initials: initialsFor(row.proposed_by_name), mine: Boolean(row.mine) },
      wrong: record ? (lang === 'ar' ? record.ar : record.en) : copy.fixesScreen.noDetail,
      fix: instruction ?? (lang === 'ar' ? row.title_ar : row.title),
      ownAgent: Boolean(row.own_agent), retest,
      change: before && after && retest.state === 'done' ? changeBetween(before, after) : null,
    };
  });
}

/** Testing the fix 3 of 8, then the result in one line. */
export function retestLine(card: FixCard, copy: Messages) {
  const text = copy.fixesScreen;
  if (card.retest.state === 'running') return fill(text.testing, { done: String(card.retest.done), total: String(card.retest.total || 8) });
  if (card.retest.state === 'stopped') return text.testStopped;
  if (card.retest.state === 'done' && card.change) return fill(text.result, { fixed: String(card.change.fixed), still: String(card.change.stillWrong), newly: String(card.change.newlyWrong) });
  if (card.retest.state === 'done') return text.tested;
  return text.notTested;
}

export function recheckLine(count: number, copy: Messages) {
  return fill(copy.fixesScreen.recheck, { n: String(count) });
}

export type Change = {
  before: number;
  after: number;
  fixed: number;
  stillWrong: number;
  newlyWrong: number;
  english: number | null;
  arabic: number | null;
};

const keyOf = (row: { scenario_id?: string; id: string }) => row.scenario_id ?? row.id;

function rate(body: ReportBody, language: string): number | null {
  const rows = caseResults(body.conversations).filter((row) => row.language === language && (row.status === 'passed' || row.status === 'failed'));
  return rows.length === 0 ? null : Math.round((rows.filter((row) => row.status === 'passed').length / rows.length) * 100);
}

/** Sample checks are independent examples, so they never establish a measured repair. */
export function measuredChange(before: ReportBody, after: ReportBody): Change | null {
  return before.sample || after.sample || !isCompleteReport(before) || !isCompleteReport(after) ? null : changeBetween(before, after);
}

/** Before and after from two saved checks. Questions are paired by their scenario, so each answer is counted once. */
export function changeBetween(before: ReportBody, after: ReportBody): Change {
  const was = new Map(caseResults(before.conversations).map((row) => [keyOf(row), row.status]));
  let fixed = 0, stillWrong = 0, newlyWrong = 0;
  for (const row of caseResults(after.conversations)) {
    const earlier = was.get(keyOf(row));
    if (earlier === undefined) continue;
    if (earlier === 'failed' && row.status === 'passed') fixed++;
    else if (earlier === 'failed' && row.status === 'failed') stillWrong++;
    else if (earlier === 'passed' && row.status === 'failed') newlyWrong++;
  }
  return { before: before.counts.passed, after: after.counts.passed, fixed, stillWrong, newlyWrong, english: rate(after, 'en'), arabic: rate(after, 'ar') };
}

export function betterLine(change: Change, copy: Messages) {
  const gap = change.after - change.before;
  if (gap > 0) return fill(copy.afterScreen.better, { n: String(gap) });
  if (gap < 0) return fill(copy.afterScreen.worse, { n: String(-gap) });
  return copy.afterScreen.same;
}

export function languageLine(change: Change, copy: Messages) {
  const parts = [
    change.english === null ? null : `${copy.afterScreen.english} ${change.english}`,
    change.arabic === null ? null : `${copy.afterScreen.arabic} ${change.arabic}`,
  ].filter(Boolean);
  return parts.join(copy.afterScreen.join);
}
