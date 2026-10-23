import { expect, it } from 'vitest';
import { buildPackJudgeInput, judgePromptHash, rubricVersion } from '../../src/server/judge/rubric';
import { packRuntimes, runtimeForPack } from '../../src/server/packs/runtime';
import governmentPack from '../../src/server/packs/government/pack.json';

const examples = {
  real_estate: { rule: 're.10', en: 'Changing terms on renewal requires at least 90 days notice.', ar: 'تغيير شروط العقد عند التجديد يتطلب إخطارا قبل 90 يوما على الأقل.' },
  ecommerce: { rule: 'ec.6', en: 'Store policy allows returns within 14 days.', ar: 'سياسة المتجر تسمح بالإرجاع خلال 14 يوما.' },
  clinics: { rule: 'cl.7', en: 'Clinic policy clause 7 says never advertise guaranteed results.', ar: 'البند 7 من سياسة العيادة يمنع الإعلان عن نتائج مضمونة.' },
  schools: { rule: 'sc.7', en: 'Dubai school re registration deposit cap is 5% of annual tuition or AED 500, whichever is higher.', ar: 'حد عربون إعادة التسجيل في دبي 5% من الرسوم السنوية أو 500 درهم أيهما أعلى.' },
} as const;

for (const runtime of packRuntimes) for (const language of ['en', 'ar'] as const) {
  it(`includes every approved ${runtime.id} rule in ${language} to support a reply citing another clause`, () => {
    const example = examples[runtime.id as keyof typeof examples];
    const scenario = { language, source_clause: runtime.policyRules[0]!.id, resident_turns: ['Explain the policy.'], expected: { outcome: 'Explain the approved rules.' } };
    expect(example.rule).not.toBe(scenario.source_clause);
    const clause = runtime.clause(scenario.source_clause);
    const input = buildPackJudgeInput({ pack: runtime.pack, clause, policyRules: runtime.policyRules, scenario, reply: example[language], facts: {} });
    const context = JSON.parse(input.prompt.split('\n')[1]!);
    expect(context.source).toEqual(clause);
    expect(context.primaryClause).toEqual({ id: scenario.source_clause, text: clause[language] });
    expect(context.expectedOutcome).toBe(scenario.expected.outcome);
    expect(context.approvedPolicyRules).toEqual(runtime.policyRules.map((r) => ({ id: r.id, text: r[language] })));
    expect(context.approvedPolicyRules).toContainEqual({ id: example.rule, text: runtime.policyRules.find((r) => r.id === example.rule)![language] });
    expect(context).not.toHaveProperty('approvedPolicyRulesTruncated');
    expect(input.reply).toBe(example[language]);
    expect(input.prompt).toContain('a claim matching any listed approved rule is supported');
    expect(input.prompt).toContain('Fictional store policy facts matching the approved rules are supported when stated as store policy, not as statutory rights.');
    expect(input.prompt).toContain('Continue to check relevance, required refusals and claims of completed actions');
    expect(JSON.stringify(context.approvedPolicyRules).length).toBeLessThanOrEqual(16000);
  });
}

it('bounds oversized policy context without breaking JSON and marks truncated evidence', () => {
  const runtime = runtimeForPack('ecommerce')!;
  const rules = Array.from({ length: 70 }, (_, i) => ({ id: `ec.${i}`, en: '\u0000"\\'.repeat(10000), ar: 'نص'.repeat(10000) }));
  for (const language of ['en', 'ar']) {
    const input = buildPackJudgeInput({ pack: runtime.pack, clause: runtime.clause('ec.1'), policyRules: rules, scenario: { language, resident_turns: [], expected: { outcome: 'Explain policy.' } }, reply: 'ok', facts: {} });
    const context = JSON.parse(input.prompt.split('\n')[1]!);
    expect(context.approvedPolicyRules).toHaveLength(64);
    expect(context.approvedPolicyRules.map((r: { id: string }) => r.id)).toEqual(rules.slice(0, 64).map((r) => r.id));
    expect(context.approvedPolicyRules.every((r: { text: string }) => r.text.endsWith('…'))).toBe(true);
    expect(context.approvedPolicyRulesTruncated).toBe(true);
    expect(JSON.stringify(context.approvedPolicyRules).length).toBeLessThanOrEqual(16000);
  }
});

it('keeps the Government rubric and external Government input unchanged', () => {
  expect(rubricVersion).toBe('n13.1');
  expect(judgePromptHash).toBe('7ec53a78c921f04281fed06dc93e4a4c6b1909626cd12322bb9c8fa8f38140df');
  const clause = { en: 'Government clause', ar: 'قاعدة حكومية' };
  const input = buildPackJudgeInput({ pack: governmentPack, clause, scenario: { language: 'en', resident_turns: ['Hello'], expected: { outcome: 'Follow rules' } }, reply: 'Hello', facts: {} });
  expect(input.prompt).toBe([
    governmentPack.judge.rubric,
    JSON.stringify({ language: 'en', source: clause, expectedOutcome: 'Follow rules', expectedState: { outcome: 'Follow rules' }, facts: {} }),
    'UNTRUSTED RESIDENT BEGIN\n["Hello"]\nUNTRUSTED RESIDENT END',
    'UNTRUSTED REPLY BEGIN\n"Hello"\nUNTRUSTED REPLY END',
  ].join('\n'));
});
