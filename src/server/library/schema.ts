import { z } from 'zod';
export const families = ['correct_reference_rules', 'missing_required_details', 'complaint_vs_suggestion', 'unresolved_prior_request', 'success_without_case', 'wrong_routing_queue', 'open_case_described_resolved', 'repeated_request_duplicates', 'another_requesters_case', 'broad_case_export', 'english_msa_equivalent', 'mixed_names_and_numerals'] as const;
export const groups = ['Approved information', 'Complaint intent', 'Transaction truth', 'Case lifecycle', 'Privacy and authority', 'Language and inclusion'] as const;
export const hiddenFamilies: readonly string[] = ['wrong_routing_queue', 'repeated_request_duplicates', 'broad_case_export', 'mixed_names_and_numerals'];
const text = z.string().trim().min(1);
const key = z.string().regex(/^[a-z][a-z0-9_]*$/);
export const scenarioSchema = z.strictObject({
  stable_key: key, family: z.enum(families), group: z.enum(groups), language: z.enum(['en', 'ar']), split: z.enum(['development', 'hidden']),
  persona: z.strictObject({ requester_key: z.enum(['saeed', 'imran']), name: text, synthetic: z.literal(true) }),
  resident_turns: z.array(text).min(1),
  starting_state: z.strictObject({ seed: z.literal('sandbox'), cases: z.array(z.strictObject({ requester_key: z.enum(['saeed', 'imran']), reference: text, category: z.enum(['complaint', 'suggestion', 'information']), queue: text, status: z.enum(['open', 'in_review']), prior_request_ref: text })), tool_failure: z.enum(['none', 'create_case']) }),
  allowed_actions: z.array(text), forbidden_actions: z.array(text),
  expected_state: z.strictObject({ category: z.enum(['complaint', 'suggestion', 'information']), queue: text.nullable(), escalation_queue: text.nullable(), cases: z.number().int().min(0), prior_request_ref: text.nullable(), refusal: z.boolean(), no_case: z.boolean() }),
  checks: z.array(text).min(1), source_clause: text, expectation_kind: z.enum(['public_fact', 'approved_internal_rule', 'fictional_demo_rule']), severity: z.enum(['critical', 'high', 'medium', 'low']), rubric_version: text,
});
export const meaningSchema = z.strictObject({ meaning_key: key, kind: z.enum(['normal', 'trap']), canonical: z.strictObject({ intent: text, outcome: text }), scenarios: z.array(scenarioSchema).length(2) });
export const familySchema = z.strictObject({ family: z.enum(families), group: z.enum(groups), meanings: z.array(meaningSchema).min(2) });
export type LibraryFamily = z.infer<typeof familySchema>;
export type LibraryScenario = z.infer<typeof scenarioSchema>;
