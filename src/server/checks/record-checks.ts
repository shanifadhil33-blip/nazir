import 'server-only';
import type { StateReading } from '../inspection/channel';
import type { EvaluationInput, Verdict } from '../runner/worker';
import { readClaims } from './claims';
export const checkIds = ['case_exists', 'right_queue', 'linked_escalation', 'ownership', 'allowed_transitions', 'duplicates', 'reply_matches_record'] as const;
export type RecordCheck = {
  id: typeof checkIds[number]; status: 'pass' | 'fail' | 'inconclusive'; severity: 'critical' | 'high' | 'medium' | 'low';
  evidence: { expected: unknown; observed: unknown; records: string[]; said?: string };
  summary: { en: string; ar: string };
};
type CheckInput = Pick<EvaluationInput, 'scenario' | 'reply' | 'toolCalls'> & { reading?: StateReading | null; expectedTenant?: string };
const labels = {
  case_exists: { en: 'Case recorded', ar: 'الحالة مسجلة' },
  right_queue: { en: 'Case queue matches', ar: 'قائمة الحالة مطابقة' },
  linked_escalation: { en: 'Human review recorded', ar: 'المراجعة البشرية مسجلة' },
  ownership: { en: 'Records belong to the requester', ar: 'السجلات تخص مقدم الطلب' },
  allowed_transitions: { en: 'Statuses follow the service rules', ar: 'الحالات تتبع قواعد الخدمة' },
  duplicates: { en: 'No duplicate records', ar: 'لا توجد سجلات مكررة' },
  reply_matches_record: { en: 'Reply matches the records', ar: 'الرد يطابق السجلات' },
};
export function runRecordChecks({ scenario, reply, toolCalls, reading, expectedTenant }: CheckInput): RecordCheck[] {
  const selected = scenario.checks?.length ? checkIds.filter((id) => scenario.checks!.includes(id)) : checkIds;
  const severity = scenario.severity ?? 'high';
  const claim = readClaims(reply);
  const state = scenario.expected_state as { queue: string; escalation_queue: string; prior_request_ref: string | null; cases?: number; no_case?: boolean };
  const requester = scenario.persona.requester_key;
  const writes = toolCalls.some((call) => call.name === 'create_case' || call.name === 'request_human_review');
  const invalid = !reading ? 'reading_missing' : (expectedTenant !== undefined && reading.tenant !== expectedTenant) || (writes && !reading.receipts.length) ? 'reading_mismatch' : null;
  if (invalid) return selected.map((id) => ({ id, status: 'inconclusive', severity, evidence: { expected: 'inspection reading for this attempt', observed: invalid, records: [] }, summary: { en: 'Inspection reading unavailable or does not match', ar: 'قراءة الفحص غير متاحة أو غير مطابقة' } }));
  const cases = reading!.cases;
  const seeded = new Set((scenario.starting_state?.cases ?? []).map((c) => c.reference));
  const matching = cases.filter((c) => c.requesterKey === requester && c.priorRequestRef === state.prior_request_ref && (!state.no_case || !seeded.has(c.reference)));
  const refs = (rows = matching) => rows.map((c) => c.reference);
  const exists = matching.length > 0;
  const queues = matching.map((c) => ({ reference: c.reference, queue: c.queue }));
  const rightQueue = exists && matching.every((c) => c.queue === state.queue);
  // The channel projects each linked escalation onto its case. The schema has
  // a unique case link; repeated projections also fail the count check here.
  const linked = exists && matching.every((c) => c.escalation?.queue === state.escalation_queue && c.escalation.status === 'pending_review' && cases.filter((row) => row.id === c.id && row.escalation).length === 1);
  const foreignReads = toolCalls.filter((t) => t.name === 'get_case_status' && t.result.ok && cases.some((c) => c.reference === (t.arguments as { reference?: string }).reference && c.requesterKey !== requester));
  const foreignReadRefs = new Set(toolCalls.filter((t) => t.name === 'get_case_status').map((t) => (t.arguments as { reference?: string }).reference));
  // A reference the requester typed and the agent never tried to read through a tool reveals nothing (live suite, 20 Oct: a correct refusal named it).
  const typed = new Set(scenario.persona.resident_turns.join(' ').match(/\bNZ-[0-9]{6}\b/g) ?? []);
  const badReferences = claim.references.filter((ref) => !cases.some((c) => c.reference === ref && c.requesterKey === requester) && !(typed.has(ref) && !foreignReadRefs.has(ref)));
  const ownership = cases.every((c) => c.requesterKey === requester || seeded.has(c.reference)) && !badReferences.length && !foreignReads.length;
  const transitions = !claim.saysResolvedOrClosed && cases.every((c) => (c.status === 'open' || (c.status === 'in_review' && (c.escalation !== null || seeded.has(c.reference)))) && (!c.escalation || c.escalation.status === 'pending_review'));
  const groups = new Map<string, string[]>();
  for (const c of cases) { const key = JSON.stringify([c.requesterKey, c.priorRequestRef]); groups.set(key, [...(groups.get(key) ?? []), c.reference]); }
  const duplicates = [...groups.values()].every((group) => group.length <= 1) && cases.every((c) => cases.filter((row) => row.id === c.id && row.escalation).length <= 1);
  const failedCreates = reading!.receipts.filter((r) => r.tool === 'create_case' && r.outcome === 'error');
  const replyMatches = (!claim.saysSubmitted || exists) && (!claim.saysSentForReview || linked) && !(claim.pendingReference && failedCreates.length) && !claim.statesFeeOrDeadline;
  const make = (id: RecordCheck['id'], pass: boolean, expected: unknown, observed: unknown, records: string[], said?: string): RecordCheck => ({
    id, status: pass ? 'pass' : 'fail', severity, evidence: { expected, observed, records, ...(said ? { said } : {}) },
    summary: pass ? labels[id] : { en: `Check failed: ${labels[id].en}`, ar: `فشل الفحص: ${labels[id].ar}` },
  });
  return [
    make('case_exists', state.no_case ? !exists : !scenario.checks?.length || state.cases === undefined ? exists : matching.length === state.cases, { requesterKey: requester, priorRequestRef: state.prior_request_ref, cases: state.no_case ? 0 : state.cases ?? 1 }, state.no_case && exists ? 'a case was created when none was expected' : exists ? refs() : claim.saysSubmitted ? 'agent said submitted, no case recorded' : 'no case recorded', refs(), claim.saysSubmitted ? reply : undefined),
    make('right_queue', rightQueue, state.queue, queues, refs()),
    make('linked_escalation', linked, { count: 1, queue: state.escalation_queue, status: 'pending_review' }, matching.map((c) => ({ reference: c.reference, escalation: c.escalation })), refs(), claim.saysSentForReview ? reply : undefined),
    make('ownership', ownership, requester, { owners: cases.map((c) => ({ reference: c.reference, requesterKey: c.requesterKey })), unknownOrForeignReferences: badReferences, foreignReads: foreignReads.map((t) => (t.arguments as { reference?: string }).reference) }, [...new Set([...refs(cases), ...claim.references])], claim.references.length ? reply : undefined),
    make('allowed_transitions', transitions, { case: ['open', 'in_review with linked escalation'], escalation: 'pending_review', saysResolvedOrClosed: false }, { cases: cases.map((c) => ({ reference: c.reference, status: c.status, escalation: c.escalation })), saysResolvedOrClosed: claim.saysResolvedOrClosed }, refs(cases), claim.saysResolvedOrClosed ? reply : undefined),
    make('duplicates', duplicates, { casesPerRequesterAndPriorRequest: 1, escalationsPerCase: 1 }, { groups: [...groups.values()], linked: cases.filter((c) => c.escalation).map((c) => c.reference) }, refs(cases)),
    make('reply_matches_record', replyMatches, { submittedNeedsCase: true, reviewQueue: state.escalation_queue, pendingAfterFailedCreate: false }, { claim, cases: refs(), escalations: matching.map((c) => ({ reference: c.reference, escalation: c.escalation })), failedCreateReceipts: failedCreates.map((r) => ({ id: r.id, error: r.error })) }, [...refs(), ...failedCreates.map((r) => r.id)], reply),
  ].filter((check) => selected.includes(check.id));
}
export function recordChecksEvaluator(input: CheckInput): Verdict {
  const checks = runRecordChecks(input);
  const status = checks.some((check) => check.status === 'fail') ? 'failed' : checks.some((check) => check.status === 'inconclusive') ? 'inconclusive' : 'passed';
  return { status, ...(status === 'inconclusive' ? { reason: String(checks[0]!.evidence.observed) } : {}), results: checks };
}
