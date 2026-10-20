import { z } from 'zod';
import { routingMap } from '../../sandbox/demo-rule-pack';
import { errorLines } from '../http/errors';

// Families a lesson may name: the 12 library families plus the legacy complaint journey.
export const lessonFamilies = ['correct_reference_rules', 'missing_required_details', 'complaint_vs_suggestion', 'unresolved_prior_request', 'success_without_case', 'wrong_routing_queue', 'open_case_described_resolved', 'repeated_request_duplicates', 'another_requesters_case', 'broad_case_export', 'english_msa_equivalent', 'mixed_names_and_numerals', 'complaint'] as const;
const family = z.enum(lessonFamilies);
export const lessonEffect = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note') }).strict(),
  z.object({ kind: z.literal('test_first'), family }).strict(),
  z.object({ kind: z.literal('test_harder'), family, repeats: z.union([z.literal(2), z.literal(3)]) }).strict(),
  z.object({ kind: z.literal('check_queue'), category: z.enum(['complaint', 'suggestion', 'information']), queue: z.string().min(1).max(60) }).strict(),
  z.object({ kind: z.literal('judge_note'), family, note: z.string().trim().min(3).max(500) }).strict(),
]);
export type LessonEffect = z.infer<typeof lessonEffect>;
export class LessonRefused extends Error {
  constructor(public code: 'effect_not_allowed' | 'changes_expected_result' | 'role' | 'not_found' | 'state', public words: { en: string; ar: string }) { super(code); }
}
export const refusals = {
  effect: errorLines.effect_not_allowed,
  expected: errorLines.changes_expected_result,
  role: errorLines.lesson_role,
  missing: errorLines.lesson_not_found,
  state: errorLines.lesson_state,
};
/** Validates an effect against the allowlist. A queue that disagrees with the approved routing map is refused. */
export function checkEffect(value: unknown): LessonEffect {
  const parsed = lessonEffect.safeParse(value);
  if (!parsed.success) throw new LessonRefused('effect_not_allowed', refusals.effect);
  const effect = parsed.data;
  if (effect.kind === 'check_queue' && routingMap[effect.category] !== effect.queue) throw new LessonRefused('changes_expected_result', refusals.expected);
  return effect;
}
/** Big lessons change how a family is judged; they wait for the service owner. */
export const scopeOf = (effect: LessonEffect): 'small' | 'big' => effect.kind === 'judge_note' ? 'big' : 'small';
export const familyOf = (effect: LessonEffect) => 'family' in effect ? effect.family : null;
export const statusLabels: Record<string, { en: string; ar: string }> = {
  active: { en: 'Active', ar: 'نشط' },
  waiting_approval: { en: 'Waiting for approval', ar: 'بانتظار الموافقة' },
  suggested: { en: 'Asked', ar: 'تم السؤال' },
  rejected: { en: 'Not remembered', ar: 'لم يحفظ' },
  deleted: { en: 'Deleted', ar: 'محذوف' },
};
export const rememberQuestion = { en: 'Should I remember this?', ar: 'هل أتذكر هذا؟' };
/** The sentence a plan or finding uses to name the lesson it applied. */
export function lessonReason(text: string, textAr: string | null, effect: LessonEffect) {
  const what = effect.kind === 'check_queue' ? { en: 'so I checked that queue first.', ar: 'لذلك فحصت ذلك الطابور أولا.' }
    : effect.kind === 'test_harder' ? { en: 'so I tested that family more times.', ar: 'لذلك اختبرت هذه المجموعة مرات أكثر.' }
    : effect.kind === 'judge_note' ? { en: 'so the reply review used that note.', ar: 'لذلك استخدمت مراجعة الرد هذه الملاحظة.' }
    : { en: 'so I tested that family first.', ar: 'لذلك اختبرت هذه المجموعة أولا.' };
  return { en: `Last time the reviewer said: "${text}", ${what.en}`, ar: `في المرة الماضية قال المراجع: «${textAr ?? text}»، ${what.ar}` };
}
