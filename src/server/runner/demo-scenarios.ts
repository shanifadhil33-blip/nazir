import 'server-only';
import { hash } from '../../sandbox/demo-rule-pack';
const definitions = [
  { stable_key: 'complaint_en', language: 'en', requester_key: 'saeed', resident_turns: ['I have a complaint about an unresolved service request. I want human review.', 'Saeed Al Hashimi, SR-1042, my permit renewal is delayed.', 'Yes, I confirm. Please request human review.'], prior_request_ref: 'SR-1042' },
  { stable_key: 'complaint_ar', language: 'ar', requester_key: 'imran', resident_turns: ['أريد تقديم شكوى عن طلب سابق لم يحل وأطلب مراجعة بشرية.', 'أنا عمران قريشي، رقم الطلب SR-2077، لم تكتمل مراجعة المستند.', 'نعم، أؤكد إنشاء الحالة وأطلب مراجعة بشرية.'], prior_request_ref: 'SR-2077' },
];
export const demoScenarios = definitions.map(({ prior_request_ref, ...data }) => {
  const scenario = { ...data, expected_state: { category: 'complaint', queue: 'complaint_review', escalation_queue: 'complaint_review', prior_request_ref, cases: 1 } };
  return Object.freeze({ ...scenario, content_hash: hash(scenario) });
});
export type RunnerScenario = { id: string; stable_key: string; language: string; content_hash: string; persona: { requester_key: string; resident_turns: string[] }; expected_state: unknown; starting_state?: { seed?: string; cases?: { reference: string; requester_key: string; queue: string; status: string }[]; tool_failure?: string }; checks?: string[]; severity?: 'critical' | 'high' | 'medium' | 'low'; source_clause?: string; canonical?: { outcome?: string }; };
