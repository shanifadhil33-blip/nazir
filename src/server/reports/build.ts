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

function withoutSecrets(finding: ReportFinding): ReportFinding {
  return {
    id: finding.id, check_id: finding.check_id, severity: finding.severity, title: finding.title, title_ar: finding.title_ar,
    really_happened: finding.really_happened, really_happened_ar: finding.really_happened_ar, split: finding.split, family: finding.family, language: finding.language,
  };
}

/** One snapshot, three copies. The viewer copy drops quotes, evidence, message text and hidden cases. */
export function projectReport(full: ReportBody, mode: 'full' | 'development' | 'viewer'): ReportBody {
  const development = mode === 'full' ? full : {
    ...full,
    conversations: full.conversations.filter((row) => row.split !== 'hidden'),
    findings: full.findings.filter((finding) => finding.split !== 'hidden'),
    messages: full.messages.filter((message) => message.split !== 'hidden'),
  };
  const findings = mode === 'viewer' ? development.findings.map(withoutSecrets) : development.findings;
  const messages = mode === 'viewer' ? [] : development.messages;
  const counts = countsOf(development.conversations, findings.length);
  return {
    ...development,
    findings, messages, counts,
    hidden_findings: full.findings.filter((finding) => finding.split === 'hidden').length,
    sentences: sentences(counts),
    scope: scopeLine,
  };
}

const escapeMap: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => escapeMap[char] ?? char);
}

/** Print ready HTML. No remote assets. The same saved copy supplies both languages. */
export function reportHtml(body: ReportBody) {
  const finding = (item: ReportFinding, language: 'en' | 'ar') => {
    const title = language === 'ar' ? (item.title_ar || item.title) : item.title;
    const happened = language === 'ar' ? (item.really_happened_ar || item.really_happened) : item.really_happened;
    const quote = item.agent_said ? `<blockquote>${escapeHtml(item.agent_said)}</blockquote>` : '';
    return `<section><h3>${escapeHtml(title)}</h3><p>${escapeHtml(item.severity)}</p><p>${escapeHtml(happened)}</p>${quote}</section>`;
  };
  const list = (lines: string[]) => lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Nazir test report</title><style>
@page { margin: 16mm; }
body { margin: 0; color: #111; font: 16px/1.5 Georgia, "Noto Naskh Arabic", serif; }
main { max-width: 40rem; margin: 0 auto; padding: 16mm; }
section { break-inside: avoid; }
@media print { body { color: #000; } a { text-decoration: none; } }
</style></head><body><main>
<h1>Nazir</h1>
<p>${escapeHtml(body.scope.en)}</p>
<ul>${list(body.sentences.en)}</ul>
${body.findings.map((item) => finding(item, 'en')).join('')}
<section lang="ar" dir="rtl">
<h2>التقرير</h2>
<p>${escapeHtml(body.scope.ar)}</p>
<ul>${list(body.sentences.ar)}</ul>
${body.findings.map((item) => finding(item, 'ar')).join('')}
</section>
</main></body></html>`;
}

export const reportId = z.uuid();
