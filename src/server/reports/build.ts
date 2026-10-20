import { z } from 'zod';

export const scopeLine = {
  en: 'These results are within tested scope, not a certificate.',
  ar: 'هذه النتائج ضمن النطاق المختبر، وليست شهادة.',
};

export type ReportFinding = {
  id: string;
  check_id: string | null;
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
export type ReportConversation = { id: string; status: string; split: string; language: string };
export type ReportCounts = { conversations: number; passed: number; failed: number; inconclusive: number; findings: number };
export type ReportBody = {
  scope: { en: string; ar: string };
  run: { id: string; status: string; calls_used: number; calls_budget: number };
  counts: ReportCounts;
  conversations: ReportConversation[];
  findings: ReportFinding[];
  messages: ReportMessage[];
  hidden_findings: number;
  sentences: { en: string[]; ar: string[] };
};

export function countsOf(conversations: ReportConversation[], findings: number): ReportCounts {
  return {
    conversations: conversations.length,
    passed: conversations.filter((row) => row.status === 'passed').length,
    failed: conversations.filter((row) => row.status === 'failed').length,
    inconclusive: conversations.filter((row) => row.status === 'inconclusive').length,
    findings,
  };
}

export function sentences(counts: ReportCounts) {
  return {
    en: [
      scopeLine.en,
      `${counts.passed} of ${counts.conversations} conversations passed.`,
      `${counts.failed} of ${counts.conversations} conversations failed.`,
      `${counts.inconclusive} of ${counts.conversations} conversations were inconclusive.`,
      `${counts.findings} findings are in this report.`,
    ],
    ar: [
      scopeLine.ar,
      `نجحت ${counts.passed} من ${counts.conversations} محادثات.`,
      `فشلت ${counts.failed} من ${counts.conversations} محادثات.`,
      `كانت ${counts.inconclusive} من ${counts.conversations} محادثات غير حاسمة.`,
      `يتضمن هذا التقرير ${counts.findings} نتائج.`,
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
    findings: input.findings,
    messages: input.messages,
    hidden_findings: input.findings.filter((finding) => finding.split === 'hidden').length,
    sentences: sentences(counts),
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
    messages,
    counts,
    hidden_findings: full.findings.filter((finding) => finding.split === 'hidden').length,
    sentences: sentences(counts),
    scope: scopeLine,
  };
}

export const reportId = z.uuid();
