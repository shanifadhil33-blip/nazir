import { z } from 'zod';
import { assessmentSchema } from '../library/assessment';
/** Every focus pack Nazir knows. Only packs with status live can be picked; drafts stay data until their cases can run. */
export const packIds = ['government', 'real_estate', 'ecommerce', 'clinics', 'schools'] as const;
export type PackId = typeof packIds[number];
export const knowledgeKinds = ['policy', 'price_table', 'faq', 'compliance', 'other'] as const;
const text = z.string().trim().min(1);
const both = z.strictObject({ en: text, ar: text });
const item = z.strictObject({ id: text, en: text, ar: text });
export const packSchema = z.strictObject({
  format: z.literal('nazir.focus_pack/1'),
  id: z.enum(packIds),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.enum(['live', 'draft']),
  /** Which sandbox runs its cases. A draft with no sandbox says none. */
  runner: z.enum(['government_sandbox', 'estate_sandbox', 'shop_sandbox', 'clinic_sandbox', 'school_sandbox', 'none']),
  name: both, summary: both,
  synthetic_data: z.literal(true),
  quick: z.strictObject({ version: z.string().regex(/^\d+\.\d+\.\d+$/), keys: z.array(text).length(8).refine((keys) => new Set(keys).size === 8, 'Quick keys must be unique.'), previous: z.array(z.strictObject({ version: text, keys: z.array(text).length(16) })).optional() }),
  cases: z.union([
    z.strictObject({ source: z.literal('library'), directory: text, families: z.number().int(), count: z.number().int().positive(), languages: z.strictObject({ en: z.number().int().positive(), ar: z.number().int().positive() }) }),
    z.strictObject({ source: z.literal('inline'), file: text, count: z.number().int().positive(), languages: z.strictObject({ en: z.number().int().positive(), ar: z.number().int().positive() }) }),
  ]),
  judge: z.strictObject({ rubric_version: text, rubric: text }),
  record_checks: z.array(item).min(1),
  record_schema: z.record(z.string(), z.unknown()),
  refusal_policies: z.array(item).min(1),
  compliance: z.array(item).min(1),
  knowledge_kinds: z.array(z.enum(knowledgeKinds)).min(1),
}).superRefine((pack, ctx) => {
  if (pack.cases.count !== pack.cases.languages.en + pack.cases.languages.ar) ctx.addIssue({ code: 'custom', path: ['cases'], message: 'Case and language totals must agree.' });
});
export type FocusPack = z.infer<typeof packSchema>;

const ref = z.string().regex(/^[a-z_]+$/);
export const inlineCaseSchema = z.strictObject({
  stable_key: z.string().regex(/^[a-z][a-z0-9_]*$/), family: ref, kind: z.enum(['normal', 'trap']), language: z.enum(['en', 'ar']),
  persona: z.strictObject({ requester_key: ref, name: text, synthetic: z.literal(true) }),
  resident_turns: z.array(text).min(1),
  starting_state: z.strictObject({ seed: text, requests: z.array(z.record(z.string(), z.string())) }),
  expected: z.strictObject({ assessment: assessmentSchema.optional(), outcome: text, refusal: z.boolean(), unit: z.string().nullable(), requests: z.array(z.strictObject({ kind: text, queue: text, unit: text.optional() })), states: z.strictObject({ status: z.boolean().optional(), permit: z.boolean().optional(), agent: z.boolean().optional(), fee: z.number().optional() }) }),
  checks: z.array(text).min(1), severity: z.enum(['critical', 'high', 'medium', 'low']), source_clause: text,
});
export const inlineCasesSchema = z.strictObject({ pack: z.enum(packIds), synthetic_data: z.literal(true), note: text, cases: z.array(inlineCaseSchema).min(48) });
export type InlineCase = z.infer<typeof inlineCaseSchema>;
