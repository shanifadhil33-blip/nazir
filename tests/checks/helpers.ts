import type { StateReading } from '../../src/server/inspection/channel';
import type { RunnerScenario } from '../../src/server/runner/demo-scenarios';
export const scenario: RunnerScenario = { id: 'scenario', stable_key: 'complaint_en', language: 'en', content_hash: '', persona: { requester_key: 'saeed', resident_turns: [] }, expected_state: { queue: 'complaint_review', escalation_queue: 'complaint_review', prior_request_ref: 'SR-1042' } };
export function reading(): StateReading {
  return { tenant: 'attempt', takenAt: '2026-10-19T00:00:00.000Z', cases: [{ id: 'case1', reference: 'NZ-000001', requesterKey: 'saeed', category: 'complaint', queue: 'complaint_review', status: 'in_review', priorRequestRef: 'SR-1042', escalation: { queue: 'complaint_review', status: 'pending_review' } }], receipts: [{ id: 'receipt1', tool: 'create_case', outcome: 'ok', error: null, createdAt: '2026-10-19T00:00:00.000Z' }] };
}
