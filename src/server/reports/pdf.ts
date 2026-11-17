import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import { caseResults, isCompleteReport, stoppedLine, type ReportBody, type ReportCounts } from './build';
import { reportConnectionScope, shapePdfLine, wrapPdfText } from './pdf-text';

export type PdfExtras = {
  lang: 'en' | 'ar';
  fontBytes: Uint8Array;
  agentName: string;
  focusPack: string;
  runDate: string;
  testNames?: Record<string, string>;
  appliedFixes?: string[];
  fixedFindingIds?: string[];
  before?: { runId: string; counts: ReportCounts } | null;
};

const copy = {
  en: {
    title: 'Report', agent: 'Agent', pack: 'What it helps with', date: 'Check date',
    score: 'Right answers', languages: 'Answers by language', en: 'English', ar: 'Arabic', tests: 'Questions checked',
    passed: 'Right', failed: 'Wrong', inconclusive: 'Could not tell', pending: 'Not checked', test: 'Question',
    changes: 'What changed', noChanges: 'No changes were applied in this check', before: 'Before', after: 'After',
    comparison: 'Each result covers its own questions. The questions may differ.',
    issues: 'Wrong answers to fix', noIssues: 'No wrong answers confirmed', untested: 'No questions checked',
    critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unspecified severity',
    footer: 'Test questions and results. Made by Nazir.',
  },
  ar: {
    title: 'تقرير', agent: 'الوكيل', pack: 'ما يساعد فيه', date: 'تاريخ الفحص',
    score: 'الإجابات الصحيحة', languages: 'الإجابات حسب اللغة', en: 'الإنجليزية', ar: 'العربية', tests: 'الأسئلة المفحوصة',
    passed: 'صحيحة', failed: 'خاطئة', inconclusive: 'لم نتمكن من الحكم', pending: 'لم تفحص', test: 'سؤال',
    changes: 'ما الذي تغير', noChanges: 'لم تطبق أي تغييرات في هذا الفحص', before: 'قبل', after: 'بعد',
    comparison: 'تغطي كل نتيجة أسئلتها الخاصة. قد تختلف الأسئلة.',
    issues: 'إجابات خاطئة تحتاج إلى إصلاح', noIssues: 'لم تتأكد أي إجابات خاطئة', untested: 'لم تفحص أي أسئلة',
    critical: 'حرجة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة', unknown: 'خطورة غير محددة',
    footer: 'أسئلة اختبار ونتائج. أعدها ناظر.',
  },
};

export function reportScore(counts: Pick<ReportCounts, 'conversations' | 'passed'>): number {
  return counts.conversations === 0 ? 0 : Math.round(counts.passed / counts.conversations * 100);
}

function rightLine(right: number, total: number, lang: 'en' | 'ar') {
  return lang === 'ar' ? `${right} من ${total} صحيحة` : `${right} of ${total} right`;
}

/** Only explicitly selected client facing fields enter the document. No transcripts or metadata. */
export function clientReportSections(body: ReportBody, extras: PdfExtras) {
  const c = copy[extras.lang];
  const complete = isCompleteReport(body);
  const cases = caseResults(body.conversations);
  const languageLines = (['en', 'ar'] as const).map((language) => {
    const rows = cases.filter((row) => row.language === language);
    return `${c[language]}: ${rows.length ? rightLine(rows.filter((r) => r.status === 'passed').length, rows.length, extras.lang) : c.untested}`;
  });
  const fixes = body.sample ? [] : extras.appliedFixes ?? [];
  const changes = [...fixes];
  if (complete && extras.before && !body.sample) {
    changes.push(`${c.before}: ${rightLine(extras.before.counts.passed, extras.before.counts.conversations, extras.lang)}`);
    changes.push(`${c.after}: ${rightLine(body.counts.passed, body.counts.conversations, extras.lang)}`, c.comparison);
  }
  if (!changes.length) changes.push(c.noChanges);
  const fixed = new Set(body.sample || !complete ? [] : extras.fixedFindingIds ?? []);
  const issues = body.findings.filter((f) => !fixed.has(f.id)).map((f) => {
    const severity = f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium' || f.severity === 'low' ? c[f.severity] : c.unknown;
    return `${severity}: ${extras.lang === 'ar' ? f.title_ar || f.title : f.title}`;
  });
  return [
    ...(reportConnectionScope(body, extras.lang) ? [{ title: (extras.lang === 'ar' ? ar : en).agentStatus.repliesOnly, lines: [reportConnectionScope(body, extras.lang)!] }] : []),
    ...(complete ? [{ title: c.score, lines: [rightLine(body.counts.passed, body.counts.conversations, extras.lang)] }, { title: c.languages, lines: languageLines }] : [{ title: stoppedLine(body, extras.lang), lines: [] }]),
    { title: `${c.tests}: ${body.counts.conversations}`, lines: [
      `${c.passed}: ${body.counts.passed}   ${c.failed}: ${body.counts.failed}   ${c.inconclusive}: ${body.counts.inconclusive}`,
      ...cases.map((row, i) => {
        if (!['passed', 'failed', 'inconclusive'].includes(row.status)) return `${extras.testNames?.[row.id] || `${c.test} ${i + 1}`} (${row.language === 'ar' ? c.ar : c.en}): ${(extras.lang === 'ar' ? ar : en).checksScreen.notChecked}`;
        const status = row.status === 'passed' ? c.passed : row.status === 'failed' ? c.failed : row.status === 'inconclusive' ? c.inconclusive : c.pending;
        return `${extras.testNames?.[row.id] || `${c.test} ${i + 1}`} (${row.language === 'ar' ? c.ar : c.en}): ${rightLine(row.passed, row.total, extras.lang)} (${status})${row.flaky ? extras.lang === 'ar' ? '. اختلفت الإجابات عند تكرار السؤال' : '. Answers differed when asked again' : ''}`;
      }),
    ] },
    { title: c.changes, lines: changes },
    { title: c.issues, lines: issues.length ? issues : [c.noIssues] },
  ];
}

/** Pure builder: the caller supplies the font and safe report context, with no I/O here. */
export type PdfSection = { title: string; lines: string[] };
/** One plain document: a title, a few head lines and sections, in English or Arabic, with the footer on every page. */
export async function linesPdf(input: { lang: 'en' | 'ar'; fontBytes: Uint8Array; title: string; head: string[]; sections: PdfSection[]; footer: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Text is already in visual order. Fontkit must not reverse Arabic a second time.
  doc.registerFontkit({ create: (bytes: Uint8Array) => {
    const font = fontkit.create(bytes);
    const layout = font.layout.bind(font) as (text: string, features: Parameters<typeof font.layout>[1], script: string, language: string, direction: string) => ReturnType<typeof font.layout>;
    font.layout = (text, features) => layout(text, features, 'latn', 'ARA', 'ltr');
    return font;
  } });
  const font = await doc.embedFont(input.fontBytes, { subset: true });
  const accent = rgb(14 / 255, 124 / 255, 134 / 255); // App teal #0E7C86
  const black = rgb(0, 0, 0);
  const width = 595.28, height = 841.89, margin = 48, usable = width - margin * 2;
  let page: PDFPage;
  let y = 0;
  const visual = (text: string) => shapePdfLine(text, input.lang);
  const draw = (text: string, size: number, atY: number, color = black) => {
    const value = visual(text);
    const textWidth = font.widthOfTextAtSize(value, size);
    page.drawText(value, { font, size, x: input.lang === 'ar' ? width - margin - textWidth : margin, y: atY, color });
  };
  const addPage = () => {
    page = doc.addPage([width, height]);
    y = height - margin;
    page.drawRectangle({ x: margin, y: y + 8, width: usable, height: 3, color: accent });
    // Reserve footer space on every page.
    for (const [i, line] of wrapPdfText(input.footer, usable, (v) => font.widthOfTextAtSize(visual(v), 9)).entries()) draw(line, 9, 28 - i * 12);
  };
  const line = (text: string, size = 11, heading = false) => {
    const lines = wrapPdfText(text, usable, (v) => font.widthOfTextAtSize(visual(v), size));
    for (const value of lines) {
      if (y - size * 1.9 < 65) addPage();
      draw(value, size, y - size, heading ? accent : black);
      y -= size * 1.9;
    }
  };
  addPage();
  line(input.title, 22, true);
  for (const text of input.head) line(text);
  for (const section of input.sections) {
    y -= 12;
    // Keep a section heading with at least one content line.
    if (y < 135) addPage();
    line(section.title, 15, true);
    for (const text of section.lines) line(text);
  }
  return doc.save();
}

export async function buildReportPdf(body: ReportBody, extras: PdfExtras): Promise<Uint8Array> {
  const c = copy[extras.lang];
  const head = [
    ...(body.sample ? [(extras.lang === 'ar' ? ar : en).shell.sample] : []),
    `${extras.lang === 'ar' ? body.run.size === 'full' ? 'فحص طويل' : 'فحص' : body.run.size === 'full' ? 'Long check' : 'Check'}, ${body.run.test_count ?? body.counts.conversations} ${extras.lang === 'ar' ? 'أسئلة' : 'questions'}`,
    `${c.agent}: ${extras.agentName}`,
    `${c.pack}: ${extras.focusPack}`,
    `${c.date}: ${extras.runDate}`,
  ];
  return linesPdf({ lang: extras.lang, fontBytes: extras.fontBytes, title: c.title, head, sections: clientReportSections(body, extras), footer: c.footer });
}
