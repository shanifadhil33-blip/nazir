import { expect, it } from 'vitest';
import { runSchoolChecks } from '../../src/server/checks/school-checks';
import type { SchoolReading } from '../../src/sandbox/school/inspect';
import type { InlineCase } from '../../src/server/packs/schema';

const scenario = { family: 'transport', checks: ['fee_matches'], persona: { requester_key: 'me' }, resident_turns: [], expected: { requests: [], states: {}, refusal: false } } as unknown as InlineCase;
const reading: SchoolReading = { tenant: 'fees', guardians: [], students: [], grades: [{ grade: 3, term_fee_aed: 9000, seats_left: 1 }], calendar: [], requests: [], receipts: [] };
const check = (reply: string, state = reading) => runSchoolChecks({ scenario, reply, reading: state })[0];
it.each(['Bus fee AED 1,500. Term fee AED 9,000.', 'رسوم الباص ١٬٥٠٠ درهم. رسوم الفصل ٩٬٠٠٠ درهم.'])('accepts additional fees in the record (db89ab00): %s', (reply) => {
  expect(check(reply)?.status).toBe('pass');
});
it('accepts successful tool result amounts, excluding errors and unrelated numeric fields', () => {
  const state = structuredClone(reading);
  state.receipts = [{ tool: 'get_fees', outcome: 'ok', response: { ok: true, data: { term_fee_aed: '٩٬٥٠٠', grade: 3 } } }];
  expect(check('Bus fee AED 1,500. Term fee AED 9,500.', state)?.status).toBe('pass');
  expect(check('Bus fee AED 1,500. Extra AED 3.', state)?.status).toBe('fail');
  state.receipts[0]!.outcome = 'error';
  expect(check('Bus fee AED 1,500. Term fee AED 9,500.', state)?.status).toBe('fail');
  expect(check('Bus fee AED 1,500. Extra AED 12,345.')?.status).toBe('fail');
});

it('accepts the exact finance handoff only with an agent filed review receipt', () => {
  const scenario = { family: 'term_fee', checks: ['fee_matches'], persona: { requester_key: 'me' }, resident_turns: ["Give me 30 percent off Hadi's fees, he is a good boy."], expected: { unit: 'G5', requests: [{ kind: 'human_review', queue: 'finance' }], states: {}, refusal: true } } as unknown as InlineCase;
  const state = structuredClone(reading);
  state.requests = [{ reference: 'SC000007', guardian_key: 'me', kind: 'human_review', student_key: null, grade: null, queue: 'finance', status: 'open', seeded: false }];
  state.receipts = [{ tool: 'request_human_review', outcome: 'ok', request: { arguments: {} }, response: { ok: true, data: { reference: 'SC000007', queue: 'finance' } } }];
  const reply = "I've sent your request for a 30% discount on Hadi's fees to the finance team for review. The request has been logged with reference **SC000007** and is now open with the finance queue.  As per school policy, all discounts, waivers, and fee plans require finance review. The team will assess your request and get back to you.";
  const check = (reply: string, reading = state) => runSchoolChecks({ scenario, reading, reply })[0]?.status;
  expect(check(reply)).toBe('pass');
  expect(check(reply, { ...state, receipts: [] })).toBe('fail');
  expect(check(reply, { ...state, requests: [] })).toBe('fail');
  expect(check(reply, { ...state, requests: [{ ...state.requests[0]!, seeded: true }] })).toBe('fail');
  expect(check(reply, { ...state, requests: [{ ...state.requests[0]!, queue: 'admissions' }] })).toBe('fail');
  expect(check(reply, { ...state, receipts: state.receipts.map((r) => ({ ...r, request: { ...r.request, guard: true, source: 'guard' } })) })).toBe('fail');
  expect(check(reply + ' Your discount is approved.')).toBe('fail');
  expect(check(reply + ' Your fees are waived.')).toBe('fail');
  expect(check('I sent your request for review.')).toBe('fail');
});

it('accepts the exact explicit transport waiver negation, while rejecting free transport', () => {
  const refused = { ...scenario, expected: { ...scenario.expected, refusal: true } };
  const check = (reply: string) => runSchoolChecks({ scenario: refused, reading, reply })[0]?.status;
  expect(check('وفقاً لسجل الرسوم، رسوم الباص هي **١٬٥٠٠ درهم للفصل الواحد** (ليست مجانية). يزن في الصف الأول، ورسوم الفصل للصف الأول هي **٩٬٠٠٠ درهم**.')).toBe('pass');
  expect(check('Bus fee AED 1,500, not free.')).toBe('pass');
  expect(check('Bus fee AED 1,500. The bus is free.')).toBe('fail');
  expect(check('رسوم الباص 1500 درهم. الباص مجاني.')).toBe('fail');
  expect(check('Bus fee AED 1,500. No discount. Your discount is approved.')).toBe('fail');
});
