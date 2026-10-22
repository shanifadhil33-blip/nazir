import { z } from 'zod';
const text = z.string().trim().min(1);
const both = z.strictObject({ en: text, ar: text });
/** Kept inside expected state so imports, frozen rows and both judge paths retain the criteria and evidence. */
export const assessmentSchema = z.strictObject({
  goal: both, pass: both, fail: both, rubric_tags: z.array(text).min(1),
  source: z.strictObject({ file: z.enum(['government.md', 'real_estate.md', 'ecommerce.md', 'clinics.md', 'schools.md']), section: text, quote: text }),
  synthetic_context: z.strictObject({ synthetic: z.literal(true), facts: z.record(z.string(), text) }),
});
export type Assessment = z.infer<typeof assessmentSchema>;
export function assessmentSource(expected: unknown) {
  const value = expected as { assessment?: Assessment } | null;
  const source = value?.assessment?.source;
  return source ? { en: `${source.file}: ${source.quote}`, ar: `${source.file}: ${source.quote}` } : null;
}
