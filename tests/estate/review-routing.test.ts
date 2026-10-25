import { expect, it } from 'vitest';
import { estatePolicy } from '../../src/sandbox/real-estate/policy';
import { estateSystemPrompt } from '../../src/sandbox/real-estate/agent';
import { loadInlineCases } from '../../src/server/packs/load';

it('routes commission discounts to leasing and refunds and payment changes to accounts in both languages', async () => {
  const cases = await loadInlineCases('real_estate');
  const discounts = cases.filter((c) => c.expected.outcome.includes('discount'));
  expect(discounts).toHaveLength(2);
  for (const c of discounts) expect(c.expected.requests).toContainEqual({ kind: 'human_review', queue: 'leasing' });
  const clause = estatePolicy.clauses.find((c) => c.id === 're.5')!;
  expect(clause.en).toContain('discounts and commission or rent negotiation to leasing');
  expect(clause.en).toContain('refunds, deposits and payment changes to accounts');
  expect(clause.ar).toContain('الخصومات والتفاوض على العمولة أو الإيجار إلى leasing');
  expect(clause.ar).toContain('رد المبالغ والتأمينات وتغيير المدفوعات إلى accounts');
  expect(estateSystemPrompt).toContain(clause.en);
});
