import { z } from 'zod';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';

export const scopeLine = {
  en: 'These results are within tested scope, not a certificate.',
  ar: 'هذه النتائج ضمن النطاق المختبر، وليست شهادة.',
};

export type ReportFinding = {
  id: string;
  check_id: string | null;
  scenario_id?: string;
  conversation_id?: string;
  failed_attempts?: number;
  severity: string;
  title: string;
  title_ar: string | null;
  really_happened: string;
  really_happened_ar: string | null;
  split: string;
  family: string;
  language: string;
  agent_said?: string;
  evidence?: unknown;
};
export type ReportMessage = { conversation_id: string; seq: number; speaker: string; body: string; split: string };
export type ReportConversation = { id: string; status: string; split: string; language: string; scenario_id?: string; attempt_number?: number; inconclusive_reason?: string | null };
export type CaseResult = ReportConversation & { passed: number; total: number; flaky: boolean; attempts: ReportConversation[]; outcome: { en: string; ar: string } };
export type ReportCounts = { conversations: number; passed: number; failed: number; inconclusive: number; findings: number };
export type ReportBody = {
  scope: { en: string; ar: string };
  run: { id: string; status: string; calls_used: number; calls_budget: number; size?: 'quick' | 'full'; test_count?: number };
  counts: ReportCounts;
  cases?: CaseResult[];
  conversations: ReportConversation[];
  findings: ReportFinding[];
  messages: ReportMessage[];
  hidden_findings: number;
  sentences: { en: string[]; ar: string[] };
};

/** Legacy snapshots have no scenario id and remain one case per conversation. */
export function caseResults(conversations: ReportConversation[]): CaseResult[] {
  const groups = new Map<string, ReportConversation[]>();
  for (const row of conversations) {
    const key = row.scenario_id ?? row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((rows) => {
    const attempts = [...rows].sort((a, b) => (a.attempt_number ?? 1) - (b.attempt_number ?? 1));
    const passed = attempts.filter((r) => r.status === 'passed').length;
    const failed = attempts.filter((r) => r.status === 'failed').length;
    const unfinished = attempts.some((r) => ['queued', 'running', 'planned'].includes(r.status));
    // A finished inconclusive attempt cannot establish a safe pass.
    const uncertain = attempts.some((r) => r.status === 'inconclusive');
    const status = failed ? 'failed' : uncertain ? 'inconclusive' : unfinished ? 'running' : passed ? 'passed' : 'cancelled';
    return { ...attempts[0]!, status, passed, total: attempts.length, flaky: passed > 0 && failed > 0, outcome: { en: attemptOutcome(passed, attempts.length, 'en'), ar: attemptOutcome(passed, attempts.length, 'ar') }, attempts };
  });
}

export function attemptOutcome(passed: number, total: number, lang: 'en' | 'ar') {
  return lang === 'ar' ? `نجح ${passed} من ${total}` : `passed ${passed} of ${total}`;
}

export function countsOf(conversations: ReportConversation[], findings: number): ReportCounts {
  const cases = caseResults(conversations);
  return {
    conversations: cases.length,
    passed: cases.filter((row) => row.status === 'passed').length,
    failed: cases.filter((row) => row.status === 'failed').length,
    inconclusive: cases.filter((row) => row.status === 'inconclusive').length,
    findings,
  };
}

export function sentences(counts: ReportCounts, conversations: ReportConversation[] = []) {
  const privateRefusal = conversations.some((c) => c.inconclusive_reason === 'external_private_address');
  return {
    en: [
      scopeLine.en,
      `${counts.passed} of ${counts.conversations} tests passed.`,
      `${counts.failed} of ${counts.conversations} tests failed.`,
      `${counts.inconclusive} of ${counts.conversations} tests were inconclusive.`,
      `${counts.findings} findings are in this report.`,
      ...(privateRefusal ? [en.settings.connectionPrivateAddress] : []),
    ],
    ar: [
      scopeLine.ar,
      `نجحت ${counts.passed} من ${counts.conversations} اختبارات.`,
      `فشلت ${counts.failed} من ${counts.conversations} اختبارات.`,
      `كانت ${counts.inconclusive} من ${counts.conversations} اختبارات غير حاسمة.`,
      `يتضمن هذا التقرير ${counts.findings} نتائج.`,
      ...(privateRefusal ? [ar.settings.connectionPrivateAddress] : []),
    ],
  };
}

export function assembleReport(input: { run: ReportBody['run']; conversations: ReportConversation[]; findings: ReportFinding[]; messages: ReportMessage[] }): ReportBody {
  const counts = countsOf(input.conversations, input.findings.length);
  return {
    scope: scopeLine,
    run: input.run,
    counts,
    conversations: input.conversations,
    cases: caseResults(input.conversations),
    findings: input.findings,
    messages: input.messages,
    hidden_findings: input.findings.filter((finding) => finding.split === 'hidden').length,
    sentences: sentences(counts, input.conversations),
  };
}

/** Development copy for a supplier: hidden cases drop out, quotes stay. There is no redacted viewer copy. */
export function projectReport(full: ReportBody, mode: 'full' | 'development'): ReportBody {
  if (mode === 'full') return { ...full, scope: scopeLine };
  const conversations = full.conversations.filter((row) => row.split !== 'hidden');
  const findings = full.findings.filter((finding) => finding.split !== 'hidden');
  const messages = full.messages.filter((message) => message.split !== 'hidden');
  const counts = countsOf(conversations, findings.length);
  return {
    ...full,
    conversations,
    findings,
    cases: caseResults(conversations),
    messages,
    counts,
    hidden_findings: full.findings.filter((finding) => finding.split === 'hidden').length,
    sentences: sentences(counts, conversations),
    scope: scopeLine,
  };
}

export const reportId = z.uuid();

/** Older snapshots fall back to their saved distinct case count. */
export function suiteLabel(body: ReportBody, lang: 'en' | 'ar') {
  const ui = (lang === 'ar' ? ar : en).ui;
  return (body.run.size === 'quick' ? ui.quickHeader : ui.fullHeader).replace('{count}', String(body.run.test_count ?? body.counts.conversations));
}
