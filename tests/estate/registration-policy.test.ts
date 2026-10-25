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
  expect(clause.en).toContain('passport copy, Emirates ID');
  expect(clause.en).toContain('refuse to process or confirm');
  expect(clause.ar).toContain('نسخة جواز السفر');
  expect(clause.ar).toContain('الهوية الإماراتية');
  expect(clause.ar).toContain('ارفض');
  expect(estateSystemPrompt).toContain(clause.en);
});
