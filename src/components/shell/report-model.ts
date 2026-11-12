import { fill, type Messages } from '@/components/ocean/copy';
import { can, type Role } from '@/server/auth/roles';
import { caseResults, completionOf, isCompleteReport, type ReportBody } from '@/server/reports/build';
import { changeBetween } from './fixes-model';
import { lastCheckText } from './home-model';

export type ReportFacts = {
  sample?: boolean;
  stopped?: { done: number; total: number };
  id: string;
  right: number;
  total: number;
  toFix: number;
  fixedThisWeek: number;
  languages: { en: boolean; ar: boolean };
  at: Date;
};

/** Report follows report.read or report.viewer on the server, so everyone may open it. */
export function reportAccess(roles: readonly string[]): boolean {
  return can(roles as Role[], 'report.read') || can(roles as Role[], 'report.viewer');
}

type Saved = { id: string; created_at: string; body: ReportBody };

/** Real numbers from the newest saved check. Fixed this week compares it with the oldest check of the last seven days. */
export function factsFromReports(reports: readonly Saved[], now: Date): ReportFacts | null {
  const latest = reports[0];
  if (!latest) return null;
  const week = 7 * 86_400_000;
  const base = [...reports].slice(1).filter((item) => isCompleteReport(item.body) && now.getTime() - new Date(item.created_at).getTime() <= week).pop();
  const rows = caseResults(latest.body.conversations);
  const has = (language: string) => rows.some((row) => row.language === language);
  return {
    id: latest.id,
    ...(!isCompleteReport(latest.body) ? { stopped: { done: completionOf(latest.body).tries_done, total: completionOf(latest.body).tries_total } } : {}),
    sample: latest.body.sample === true,
    right: latest.body.counts.passed,
    total: latest.body.counts.conversations,
    toFix: latest.body.counts.failed,
    fixedThisWeek: base && isCompleteReport(latest.body) && !base.body.sample && !latest.body.sample ? changeBetween(base.body, latest.body).fixed : 0,
    languages: { en: has('en'), ar: has('ar') },
    at: new Date(latest.created_at),
  };
}

export function headlineText(facts: ReportFacts, copy: Messages): string {
  if (facts.stopped) return fill(copy.checksScreen.stopped, { done: String(facts.stopped.done), total: String(facts.stopped.total) });
  return fill(copy.reportScreen.headline, { n: String(facts.right), total: String(facts.total) });
}

export function captionText(facts: ReportFacts, assistant: string, now: Date, copy: Messages): string {
  return fill(copy.reportScreen.caption, { name: assistant, when: lastCheckText(facts.at, now, copy).toLowerCase() });
}

export function languageRow(facts: ReportFacts, copy: Messages): string {
  const text = copy.reportScreen;
  if (facts.languages.en && facts.languages.ar) return text.both;
  return facts.languages.ar ? text.onlyAr : text.onlyEn;
}

export const pdfHref = (workspaceId: string, reportId: string, lang: 'en' | 'ar') => `/api/workspaces/${workspaceId}/reports/${reportId}/pdf?lang=${lang}`;
export const shareHref = (workspaceId: string, reportId: string) => `/w/${workspaceId}/report/${reportId}`;

/** Made up numbers for the preview page only. */
export function previewFacts(now: Date): ReportFacts {
  return { id: 'preview', right: 82, total: 100, toFix: 2, fixedThisWeek: 9, languages: { en: true, ar: true }, at: now };
}
