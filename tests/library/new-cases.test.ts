import { expect, it } from 'vitest';
import { loadLibrary } from '../../src/server/library/load';
import { loadInlineCases } from '../../src/server/packs/load';
import { packById } from '../../src/server/packs/catalog';
import { quickCases } from '../../src/server/packs/quick';
import { buildJudgeInput, buildPackJudgeInput } from '../../src/server/judge/rubric';
import type { RunnerScenario } from '../../src/server/runner/demo-scenarios';
import type { Assessment } from '../../src/server/library/assessment';

for (const [id, ideas] of [['government', 5], ['real_estate', 5], ['ecommerce', 5], ['clinics', 5], ['schools', 8]] as const) {
  it(`keeps all ${ideas} verified ${id} ideas as bilingual full suite cases with criteria in the judge prompt`, async () => {
    const pack = packById(id)!;
    const cases = id === 'government' ? (await loadLibrary()).flatMap((f) => f.meanings.flatMap((m) => m.scenarios)) : await loadInlineCases(id);
    const added = cases.filter((c) => c.stable_key.startsWith('kb_'));
    expect(added).toHaveLength(ideas * 2);
    expect(cases).toHaveLength(pack.cases.count);
    expect(quickCases<{ stable_key: string; language: string }>(pack, cases)).toHaveLength(16);
    expect(quickCases<{ stable_key: string; language: string }>(pack, cases).every((c) => !c.stable_key.startsWith('kb_'))).toBe(true);
    const twins = new Map<string, typeof added>();
    for (const c of added) twins.set(c.stable_key.replace(/_(en|ar)$/, ''), [...(twins.get(c.stable_key.replace(/_(en|ar)$/, '')) ?? []), c]);
    for (const pair of twins.values()) {
      expect(pair.map((c) => c.language).sort()).toEqual(['ar', 'en']);
      const assessments = pair.map((c) => ('expected_state' in c ? c.expected_state : c.expected).assessment!);
      expect(assessments[0]).toEqual(assessments[1]);
    }
    for (const c of added) {
      expect(c.persona.synthetic).toBe(true);
      const expected = 'expected_state' in c ? c.expected_state : c.expected;
      const a = expected.assessment as Assessment;
      expect(a.source.file).toBe(`${id}.md`);
      expect(a.source.quote.length).toBeGreaterThan(30);
      expect(a.rubric_tags.length).toBeGreaterThan(0);
      expect(a.synthetic_context.synthetic).toBe(true);
      for (const lang of ['en', 'ar'] as const) for (const field of ['goal', 'pass', 'fail'] as const) {
        expect(a[field][lang].length).toBeGreaterThan(15);
        expect(/[\u0600-\u06ff]/.test(a[field][lang])).toBe(lang === 'ar');
        expect(a[field][lang]).not.toMatch(/ - |\u2013|\u2014/);
      }
      const input = 'expected_state' in c
        ? buildJudgeInput({ scenario: { ...c, id: 'test', content_hash: 'test', persona: { ...c.persona, resident_turns: c.resident_turns } } as RunnerScenario, reply: 'test', reading: { tenant: 'test', cases: [], receipts: [] } as never })
        : buildPackJudgeInput({ pack, clause: { en: 'Old demo clause', ar: 'قاعدة تجريبية قديمة' }, scenario: c, reply: 'test', facts: {} });
      expect(input.prompt).toContain(JSON.stringify(a.pass));
      expect(input.prompt).toContain(JSON.stringify(a.fail));
      expect(input.prompt).toContain(JSON.stringify(a.source.quote).slice(1, -1));
      expect(input.prompt).toContain('rubric_tags');
      expect(input.prompt).not.toContain('Old demo clause');
    }
  });
}

it('retains the checked numerical boundaries rather than the unsupported amounts in customer requests', async () => {
  const estate = await loadInlineCases('real_estate');
  const schools = await loadInlineCases('schools');
  const shop = await loadInlineCases('ecommerce');
  const pass = (cases: typeof estate, key: string) => cases.find((c) => c.stable_key === `kb_${key}_en`)!.expected.assessment!.pass.en;
  expect(pass(estate, 'decree_slab_five')).toContain('5%');
  expect(pass(estate, 'decree_no_increase')).toContain('No increase');
  expect(pass(estate, 'ejari_published_fees')).toMatch(/177\.75.*220/);
  expect(pass(schools, 'reregistration_cap_math')).toContain('AED 1,000');
  expect(pass(schools, 'term_one_payment_cap')).toContain('40%, 30%, 30%');
  expect(pass(schools, 'fee_increase_day_eight')).toContain('10 calendar days');
  expect(pass(shop, 'saudi_delivery_twenty_late')).toContain('more than 15 days late');
  expect(pass(shop, 'saudi_rescission_day_four')).toContain('seven days of receipt');
});
