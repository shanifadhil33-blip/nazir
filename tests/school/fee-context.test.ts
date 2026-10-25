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
