import { checkDate } from '@/server/reports/date';
import { fill, type Lang, type Messages } from '@/components/ocean/copy';
import { caseResults, completionOf, isCompleteReport, type ReportBody } from '@/server/reports/build';
import { presentQuote, presentRecord } from '@/components/ocean/plain';
import { can, type Role } from '@/server/auth/roles';
import { daysBetween } from './home-model';

export type Mark = 'right' | 'wrong' | 'unsure' | 'notChecked';
export type QuestionRow = { id: string; question: string; mark: Mark; said: string; record: string; findingId: string | null };
export type CheckRow = { sample?: boolean; stopped?: { done: number; total: number }; id: string; kind: 'quick' | 'full'; at: Date; toFix: number; questions: QuestionRow[] };
export type ChecksAccess = { start: boolean; stop: boolean; suggest: boolean };

/** Buttons follow the server role matrix: start and stop follow plan.propose and plan.approve, suggest follows proposal.create. */
export function checksAccess(roles: readonly string[]): ChecksAccess {
  const list = roles as Role[];
  return { start: can(list, 'plan.propose'), stop: can(list, 'plan.approve'), suggest: can(list, 'proposal.create') };
}

export function markFor(status: string): Mark {
  if (status === 'passed') return 'right';
  if (status === 'failed') return 'wrong';
  return ['cancelled', 'queued', 'running', 'planned'].includes(status) ? 'notChecked' : 'unsure';
}

/** One row per question. The question is the first thing the person asked, the answer is the last reply the assistant saved. */
export function checkFromReport(id: string, createdAt: string, body: ReportBody, lang: Lang, copy: Messages): CheckRow {
  const cases = caseResults(body.conversations);
  const empty = { en: copy.checksScreen.noReply, ar: copy.checksScreen.noReply };
  const questions = cases.map((row, index): QuestionRow => {
    const ids = new Set(row.attempts.map((attempt) => attempt.id));
    const messages = body.messages.filter((message) => ids.has(message.conversation_id)).sort((a, b) => a.seq - b.seq);
    const asked = messages.find((message) => message.speaker !== 'agent')?.body.trim();
    const replied = [...messages].reverse().find((message) => message.speaker === 'agent')?.body;
    const finding = body.findings.find((item) => (item.scenario_id !== undefined && item.scenario_id === row.scenario_id) || ids.has(item.conversation_id ?? ''));
    const said = presentQuote(finding?.agent_said ?? replied, empty);
    const record = finding ? presentRecord(finding.really_happened, finding.really_happened_ar) : null;
    return {
      id: row.id,
      question: asked || fill(copy.checksScreen.question, { n: String(index + 1) }),
      mark: markFor(row.status),
      said: lang === 'ar' ? said.ar : said.en,
      record: record ? (lang === 'ar' ? record.ar : record.en) : '',
      findingId: finding?.id ?? null,
    };
  });
  return {
    id,
    ...(!isCompleteReport(body) ? { stopped: { done: completionOf(body).tries_done, total: completionOf(body).tries_total } } : {}),
    sample: body.sample === true,
    kind: body.run.size === 'full' ? 'full' : 'quick',
    at: checkDate(createdAt, body),
    toFix: questions.filter((item) => item.mark === 'wrong').length,
    questions,
  };
}

export function checksFromReports(reports: { id: string; created_at: string; body: ReportBody }[], lang: Lang, copy: Messages): CheckRow[] {
  return reports.map((report) => checkFromReport(report.id, report.created_at, report.body, lang, copy));
}

export function kindLabel(kind: CheckRow['kind'], copy: Messages) {
  return kind === 'full' ? copy.checksScreen.full : copy.checksScreen.quick;
}

export function resultLabel(toFix: number, copy: Messages) {
  return toFix > 0 ? fill(copy.checksScreen.toFix, { n: String(toFix) }) : copy.checksScreen.allRight;
}

/** Today, Yesterday, then the weekday inside a week, then the date. Calendar days in Dubai. */
export function dayLabel(at: Date, now: Date, lang: Lang, copy: Messages): string {
  const days = daysBetween(at, now);
  if (days === 0) return copy.checksScreen.today;
  if (days === 1) return copy.checksScreen.yesterday;
  const options: Intl.DateTimeFormatOptions = days < 7 ? { weekday: 'long' } : { day: 'numeric', month: 'short' };
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Dubai', ...options }).format(at);
}

export function progressLine(done: number, total: number, copy: Messages) {
  return fill(copy.checksScreen.progress, { done: String(done), total: String(total) });
}

export function progressPercent(done: number, total: number) {
  return total <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** The message that asks the assistant for a fix for one finding. The server still checks the role. */
export function suggestMessage(findingId: string, lang: Lang) {
  return lang === 'ar' ? `اقترح إصلاحاً للنتيجة ${findingId}` : `propose a repair for finding ${findingId}`;
}

/** The two messages the server expects to start a check. The reason line is the exact approval wording. */
export function approvalMessage(planId: string, lang: Lang) {
  return lang === 'ar'
    ? `أوافق على الخطة ${planId} وأبدأ التشغيل لأن مراجعتي لحجم الفحص والتكلفة تمت. اطلعت على الدليل.`
    : `I approve plan ${planId} and start the run because I reviewed the check size and cost. I opened the evidence.`;
}

export function checkResultLabel(check: CheckRow, copy: Messages) {
  return check.stopped ? fill(copy.checksScreen.stopped, { done: String(check.stopped.done), total: String(check.stopped.total) }) : resultLabel(check.toFix, copy);
}
