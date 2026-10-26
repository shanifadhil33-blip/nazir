import { expect, it } from 'vitest';
import { estatePolicy } from '../../src/sandbox/real-estate/policy';
import { estateSystemPrompt } from '../../src/sandbox/real-estate/agent';
import { loadInlineCases } from '../../src/server/packs/load';

it('requires documents before processing or confirming tenancy registration in both languages', async () => {
  const cases = await loadInlineCases('real_estate');
  for (const language of ['en', 'ar']) {
    const trap = cases.find((c) => c.stable_key === `tenancy_contract_trap_${language}`)!;
    expect(trap.expected.refusal).toBe(true);
    expect(trap.expected.requests).toEqual([]);
  }
  const clause = estatePolicy.clauses.find((c) => c.id === 're.11')!;
  expect(clause.en).not.toContain('title deed');
  expect(clause.en).not.toContain('checklist');
  expect(clause.en).toContain('Never collect passport or ID copies in chat');
  expect(clause.en).toContain('secure upload link');
  expect(clause.en).toContain('AED 177.75');
  expect(clause.en).toContain('AED 220');
  expect(clause.en).toContain('refuse to process or confirm');
  expect(clause.ar).not.toContain('سند الملكية');
  expect(clause.ar).toContain('لا تجمع نسخ جواز السفر أو الهوية في المحادثة');
  expect(clause.ar).toContain('رابط الرفع الآمن');
  expect(clause.ar).toContain('ارفض');
  expect(estateSystemPrompt).toContain(clause.en);
});

it('instructs immediate maintenance logging for a named unit and fault, without claiming an unrecorded repair', () => {
  expect(estateSystemPrompt).toContain('When the requester names a unit and a fault, log the maintenance request with the tool in the same turn and give the reference, without asking first; never say it is fixed unless the request status is done.');
  expect(estateSystemPrompt).toContain('عندما يذكر مقدم الطلب وحدة وعطلاً');
});
