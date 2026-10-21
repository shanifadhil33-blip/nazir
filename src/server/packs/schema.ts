import { z } from 'zod';
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
  name: both, summary: both,
  synthetic_data: z.literal(true),
  cases: z.union([
    z.strictObject({ source: z.literal('library'), directory: text, families: z.number().int(), count: z.literal(48), languages: z.strictObject({ en: z.literal(24), ar: z.literal(24) }) }),
    z.strictObject({ source: z.literal('inline'), file: text, count: z.literal(48), languages: z.strictObject({ en: z.literal(24), ar: z.literal(24) }) }),
  ]),
  judge: z.strictObject({ rubric_version: text, rubric: text }),
  record_checks: z.array(item).min(1),
  record_schema: z.record(z.string(), z.unknown()),
  refusal_policies: z.array(item).min(1),
  compliance: z.array(item).min(1),
  knowledge_kinds: z.array(z.enum(knowledgeKinds)).min(1),
});
export type FocusPack = z.infer<typeof packSchema>;
