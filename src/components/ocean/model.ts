import type { ReportBody } from '@/server/reports/build';
import { fill, messagesFor, type Lang, type Messages } from './copy';
import { presentQuote, presentRecord } from './plain';

export type Seat = 'owner' | 'editor' | 'supplier' | 'viewer';
export type ScreenId = 'chat' | 'score' | 'failures' | 'report';
export type Status = 'waiting' | 'running' | 'idle';

export type Metrics = {
  score: number;
  pass: number;
  fail: number;
  critical: number;
  safety: number;
  accuracy: number;
  rules: number;
  recovery: number;
};

export type LogEvent = {
  id: string;
  kind: 'suite' | 'score' | 'critical' | 'finding' | 'diagnosis' | 'fix' | 'applied' | 'recheck' | 'error' | 'user' | 'note';
  title: string;
  body: string;
  detail?: string;
  proposalId?: string;
};

export type FailureCase = {
  id: string;
  tab: string;
  tabAr: string;
  caseLabel: string;
  expectedEn: string;
  expectedAr: string;
  actualEn: string;
  actualAr: string;
  diagnosis: string;
  proposed: string;
  proposalId?: string;
  rawEn?: string;
  rawAr?: string;
  rawQuote?: string;
};

export type FixRow = { id: string; title: string; name: string; role: string; at: Date };

export type ScreenModel = {
  agentName: string;
  status: Status;
  metrics: Metrics;
  before: Metrics | null;
  events: LogEvent[];
  failures: FailureCase[];
  fixes: FixRow[];
  coverage: string;
  sample: boolean;
};

export function seatFromRoles(roles: readonly string[]): Seat {
  if (roles.includes('service_owner')) return 'owner';
  if (roles.includes('quality_reviewer')) return 'editor';
  if (roles.includes('supplier_maintainer')) return 'supplier';
  return 'viewer';
}

export function rolesForSeat(seat: Seat): string[] {
  if (seat === 'owner') return ['service_owner'];
  if (seat === 'editor') return ['quality_reviewer'];
  if (seat === 'supplier') return ['supplier_maintainer'];
  return ['viewer'];
}

/** Matches proposal.decide: only a quality reviewer may approve or skip a fix. */
export function canApprove(roles: readonly string[], shared = false) {
  return !shared && roles.includes('quality_reviewer');
}

/** Matches plan.approve: an owner or a quality reviewer may run a recheck. */
export function canRunRecheck(roles: readonly string[], shared = false) {
  return !shared && roles.some((role) => role === 'service_owner' || role === 'quality_reviewer');
}

export function canCompose(seat: Seat, shared = false) {
  return !shared && seat !== 'viewer';
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));

/** Rates taken only from the saved report counts. */
export function metricsFromReport(body: ReportBody): Metrics {
  const conversations = body.counts.conversations;
  const pass = body.counts.passed;
  const fail = body.counts.failed;
  const critical = body.findings.filter((finding) => finding.severity === 'critical').length;
  const score = conversations === 0 ? 0 : Math.round((pass / conversations) * 100);
  const safety = conversations === 0 ? 0 : clamp(Math.round(((conversations - Math.min(critical, conversations)) / conversations) * 100));
  const rules = conversations === 0 ? 0 : clamp(Math.round(((conversations - fail) / conversations) * 100));
  const recovery = conversations === 0 ? 0 : clamp(Math.round(((conversations - body.counts.inconclusive) / conversations) * 100));
  return { score, pass, fail, critical, safety, accuracy: score, rules, recovery };
}

export function dubaiStamp(date: Date, lang: Lang) {
  const parts = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', {
    timeZone: 'Asia/Dubai',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}`;
}

export function sampleModel(copy: Messages): ScreenModel {
  const metrics: Metrics = { score: 82, pass: 41, fail: 7, critical: 2, safety: 94, accuracy: 86, rules: 72, recovery: 76 };
  const before: Metrics = { score: 74, pass: 36, fail: 11, critical: 4, safety: 81, accuracy: 74, rules: 61, recovery: 64 };
  const sample = copy.sample;
  return {
    agentName: sample.agent,
    status: 'waiting',
    metrics,
    before,
    sample: true,
    coverage: sample.coverage,
    fixes: [
      { id: 'dates', title: sample.fixTitle, name: sample.fixName, role: copy.ui.roleEditor, at: new Date(Date.UTC(2026, 9, 20, 11, 8)) },
      { id: 'visa', title: sample.visaFixTitle, name: sample.fixName, role: copy.ui.roleEditor, at: new Date(Date.UTC(2026, 9, 20, 11, 21)) },
    ],
    events: [
      { id: 'suite', kind: 'suite', title: copy.ui.suiteOpened, body: sample.suite },
      { id: 'score', kind: 'score', title: copy.ui.scorePosted, body: sample.score },
      { id: 'critical', kind: 'critical', title: copy.ui.criticalFinding, body: sample.critical },
      { id: 'second', kind: 'critical', title: copy.ui.secondCritical, body: sample.second },
      { id: 'diagnosis', kind: 'diagnosis', title: copy.ui.diagnosis, body: sample.diagnosis },
      { id: 'fix', kind: 'fix', title: copy.ui.proposedFix, body: sample.fix },
    ],
    failures: [
      {
        id: 'refund',
        tab: sample.refundTab,
        tabAr: arTab(copy, 'refund'),
        caseLabel: sample.case18,
        expectedEn: sample.refundExpectedEn,
        expectedAr: sample.refundExpectedAr,
        actualEn: sample.refundActualEn,
        actualAr: sample.refundActualAr,
        diagnosis: sample.refundDiagnosis,
        proposed: sample.refundFix,
      },
      {
        id: 'visa',
        tab: sample.visaTab,
        tabAr: arTab(copy, 'visa'),
        caseLabel: sample.case27,
        expectedEn: sample.visaExpectedEn,
        expectedAr: sample.visaExpectedAr,
        actualEn: sample.visaActualEn,
        actualAr: sample.visaActualAr,
        diagnosis: sample.visaDiagnosis,
        proposed: sample.visaFix,
      },
    ],
  };
}

function arTab(copy: Messages, which: 'refund' | 'visa') {
  return which === 'refund' ? copy.sample.refundTab : copy.sample.visaTab;
}

export function modelFromReports(latest: ReportBody, previous: ReportBody | null, copy: Messages, lang: Lang, agentName: string, sample: boolean): ScreenModel {
  const metrics = metricsFromReport(latest);
  const before = previous ? metricsFromReport(previous) : null;
  const lines = lang === 'ar' ? latest.sentences.ar : latest.sentences.en;
  const findings = [...latest.findings].sort((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical'));
  const events: LogEvent[] = [
    { id: 'suite', kind: 'suite', title: copy.ui.suiteOpened, body: lines[0] ?? '' },
    { id: 'score', kind: 'score', title: copy.ui.scorePosted, body: lines.slice(1).join(' ') },
  ];
  const emptyQuote = { en: messagesFor('en').ui.noQuote, ar: messagesFor('ar').ui.noQuote };
  findings.forEach((finding, index) => {
    const title = lang === 'ar' ? (finding.title_ar || finding.title) : finding.title;
    const record = presentRecord(finding.really_happened, finding.really_happened_ar);
    const detail = lang === 'ar' ? record.rawAr : record.rawEn;
    events.push({
      id: finding.id,
      kind: finding.severity === 'critical' ? 'critical' : 'finding',
      title: index === 0 && finding.severity === 'critical' ? copy.ui.criticalFinding : title,
      body: lang === 'ar' ? record.ar : record.en,
      ...(detail ? { detail } : {}),
    });
  });
  const languages = new Set(latest.conversations.map((row) => row.language));
  const coverage = languages.has('en') && languages.has('ar')
    ? fill(copy.ui.coverageBoth, { count: String(latest.counts.conversations) })
    : fill(copy.ui.coverageOne, { count: String(latest.counts.conversations) });
  return {
    agentName,
    status: findings.some((finding) => finding.severity === 'critical') ? 'waiting' : 'idle',
    metrics,
    before,
    sample,
    coverage,
    fixes: [],
    events,
    failures: findings.filter((finding) => finding.severity === 'critical' || findings.every((row) => row.severity !== 'critical')).map((finding, index) => {
      const record = presentRecord(finding.really_happened, finding.really_happened_ar);
      const spoken = presentQuote(finding.agent_said, emptyQuote);
      return {
        id: finding.id,
        tab: finding.title,
        tabAr: finding.title_ar || finding.title,
        caseLabel: `${copy.ui.caseWord} ${index + 1}`,
        expectedEn: record.en,
        expectedAr: record.ar,
        actualEn: spoken.en,
        actualAr: spoken.ar,
        diagnosis: lang === 'ar' ? record.ar : record.en,
        proposed: '',
        ...(record.rawEn ? { rawEn: record.rawEn } : {}),
        ...(record.rawAr ? { rawAr: record.rawAr } : {}),
        ...(spoken.raw ? { rawQuote: spoken.raw } : {}),
      };
    }),
  };
}

export const emptyModel = (copy: Messages, agentName: string): ScreenModel => ({
  agentName,
  status: 'idle',
  metrics: { score: 0, pass: 0, fail: 0, critical: 0, safety: 0, accuracy: 0, rules: 0, recovery: 0 },
  before: null,
  events: [],
  failures: [],
  fixes: [],
  coverage: fill(copy.ui.coverageOne, { count: '0' }),
  sample: false,
});
