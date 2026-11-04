import { fill, type Lang, type Messages } from '@/components/ocean/copy';
import { canApprove, canRunRecheck } from '@/components/ocean/model';
import { presentRecord } from '@/components/ocean/plain';
import { can, type Role } from '@/server/auth/roles';
import { caseResults, type ReportBody } from '@/server/reports/build';

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
};

export type FixCard = {
  id: string;
  status: FixStatus;
  title: string;
  by: { name: string; initials: string; mine: boolean };
  wrong: string;
  fix: string;
  recheck: number;
  rerun: boolean;
};

export type FixesAccess = { decide: boolean; recheck: boolean };

/** Approve and Turn down follow proposal.decide, Check again follows plan.approve. The server checks again. */
export function fixesAccess(roles: readonly string[]): FixesAccess {
  return { decide: canApprove(roles), recheck: canRunRecheck(roles) };
}

export function canSuggest(roles: readonly string[]) {
  return can(roles as Role[], 'proposal.create');
}

export const storeKeyFor = (workspaceId: string) => `nz-fixes-${workspaceId}`;

export function readStore(raw: string | null): StoredFix[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((item): item is StoredFix => Boolean(item) && typeof item === 'object' && typeof (item as StoredFix).id === 'string' && typeof (item as StoredFix).findingId === 'string');
  } catch {
    return [];
  }
}

export function upsertFix(list: StoredFix[], next: StoredFix): StoredFix[] {
  return [next, ...list.filter((item) => item.id !== next.id)];
}

export function patchFix(list: StoredFix[], id: string, patch: Partial<StoredFix>): StoredFix[] {
  return list.map((item) => item.id === id ? { ...item, ...patch } : item);
}

const uuid = /^[0-9a-f-]{36}$/i;
export function idOf(data: unknown): string | null {
  const id = data && typeof data === 'object' ? (data as { id?: unknown }).id : null;
  return typeof id === 'string' && uuid.test(id) ? id : null;
}

export function titleOf(data: unknown, fallback: { en: string; ar: string }): { en: string; ar: string } {
  const title = data && typeof data === 'object' ? (data as { title?: { en?: unknown; ar?: unknown } }).title : null;
  return { en: typeof title?.en === 'string' ? title.en : fallback.en, ar: typeof title?.ar === 'string' ? title.ar : fallback.ar };
}

/** How many questions the server chose to ask again, read from the approval answer. */
export function recheckCount(data: unknown): number | null {
  const retest = data && typeof data === 'object' ? (data as { retest?: { retest?: unknown[] } | null }).retest : null;
  const list = retest?.retest;
  return Array.isArray(list) ? list.length : null;
}

/** The two exact messages the server expects. Same wording as the chat screen. */
export function decisionMessage(id: string, decision: 'approve' | 'reject', lang: Lang) {
  if (decision === 'approve') {
    return lang === 'ar'
      ? `أوافق على الإصلاح ${id} لأنني راجعت الإجابة المتوقعة والإجابة الفعلية في عرض الخطأ. اطلعت على الدليل.`
      : `I approve repair ${id} because I reviewed the expected and actual answers in the failure view. I opened the evidence.`;
  }
  return lang === 'ar'
    ? `أرفض الإصلاح ${id} لأنني راجعت الإجابة المتوقعة والإجابة الفعلية ولا أوافق على التغيير الآن. اطلعت على الدليل.`
    : `I reject repair ${id} because I reviewed the expected and actual answers and do not accept this change yet. I opened the evidence.`;
}

export function recheckMessage(id: string, lang: Lang) {
  return lang === 'ar' ? `أعد الاختبارات المتأثرة ${id}` : `rerun the affected tests ${id}`;
}

/** Turns what was kept plus the latest report into cards. Plain words only. */
export function cardsFrom(stored: StoredFix[], body: ReportBody | null, lang: Lang, copy: Messages, me: string): FixCard[] {
  return stored.map((item) => {
    const finding = body?.findings.find((row) => row.id === item.findingId);
    const record = finding ? presentRecord(finding.really_happened, finding.really_happened_ar) : null;
    const wrong = record ? (lang === 'ar' ? record.ar : record.en) : copy.fixesScreen.noDetail;
    const cases = body ? caseResults(body.conversations) : [];
    const related = finding ? cases.filter((row) => row.status === 'failed' && (row.scenario_id === finding.scenario_id || row.attempts.some((a) => a.id === finding.conversation_id))).length : 0;
    const title = finding ? (lang === 'ar' ? (finding.title_ar || finding.title) : finding.title) : (lang === 'ar' ? item.title.ar : item.title.en);
    return {
      id: item.id, status: item.status, title, by: { ...item.by, mine: item.by.name === me }, wrong,
      fix: lang === 'ar' ? item.title.ar : item.title.en,
      recheck: item.recheck ?? Math.max(1, related),
      rerun: item.rerun,
    };
  });
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
