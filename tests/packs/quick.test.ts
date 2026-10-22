import { expect, it } from 'vitest';
import { focusPacks, packById } from '../../src/server/packs/catalog';
import { loadInlineCases, loadPackCases } from '../../src/server/packs/load';
import { planSize, quickCases } from '../../src/server/packs/quick';
import { proposeInput } from '../../src/server/planner/bound';
import { chatIntent, sizeFrom, mcpPlan } from '../../src/server/agent/intent';
import { estimateRun } from '../../src/server/runner/estimate';
import { assembleReport, suiteLabel } from '../../src/server/reports/build';

const plantedFamilies: Record<string, string[]> = {
  government: ['wrong_routing_queue', 'success_without_case'],
  real_estate: ['viewing_booking', 'listing_status'],
  ecommerce: ['order_status', 'refund_request'],
  clinics: ['appointment_booking', 'prescription_refill'],
  schools: ['seat_availability', 'safeguarding'],
};
for (const pack of focusPacks) it(`${pack.id} has a fixed versioned quick set with balanced family, language, safety and planted coverage`, async () => {
  const cases: { stable_key: string; family: string; language: string; refusal: boolean }[] = pack.id === 'government'
    ? (await loadPackCases()).flatMap((f) => f.meanings.flatMap((m) => m.scenarios)).map((s) => ({ ...s, refusal: Boolean(s.expected_state.refusal) }))
    : (await loadInlineCases(pack.id)).map((s) => ({ ...s, refusal: s.expected.refusal }));
  const selected = quickCases(pack, cases);
  expect(pack.quick.version).toBe('1.0.0');
  expect(selected).toHaveLength(16);
  expect(selected.map((c) => c.stable_key)).toEqual(pack.quick.keys);
  expect(new Set(selected.map((c) => c.family)).size).toBe(12);
  const counts = [...new Set(selected.map((c) => c.family))].map((f) => selected.filter((c) => c.family === f).length);
  expect(Math.max(...counts) - Math.min(...counts)).toBe(1);
  for (const lang of ['en', 'ar']) {
    const rows = selected.filter((s) => s.language === lang);
    expect(rows).toHaveLength(8);
    expect(rows.filter((s) => s.refusal).length).toBeGreaterThanOrEqual(2);
    expect(rows.filter((s) => plantedFamilies[pack.id]!.includes(s.family)).length).toBeGreaterThanOrEqual(2);
  }
  expect(() => quickCases(pack, cases.filter((c) => c.stable_key !== pack.quick.keys[0]))).toThrow();
  expect(() => quickCases({ ...pack, quick: { ...pack.quick, keys: Array(16).fill(pack.quick.keys[0]) } }, cases)).toThrow();
  expect(() => quickCases(pack, cases.map((c) => ({ ...c, language: 'en' })))).toThrow();
});

it('accepts only quick or full in plan creation and MCP approval', () => {
  const ids = { agent_version_id: crypto.randomUUID(), rule_pack_version_id: crypto.randomUUID() };
  for (const size of ['quick', 'full']) expect(proposeInput.parse({ ...ids, size }).size).toBe(size);
  for (const size of ['small', '', 16, null]) {
    expect(planSize.safeParse(size).success).toBe(false);
    expect(proposeInput.safeParse({ ...ids, size }).success).toBe(false);
    expect(mcpPlan({ plan_id: ids.agent_version_id, reason: 'Reviewed the cases.', evidence_opened: true, size })).toBeNull();
  }
});
it.each(['run a quick check', 'فحص سريع'])('recognizes the quick request %s without starting before approval', (message) => {
  expect(chatIntent(message)).toBe('propose_plan');
  expect(sizeFrom(message)).toBe('quick');
});
it.each([1, 2, 3])('estimates exactly 16 times %i attempts', (repeats) => {
  const keys = packById('government')!.quick.keys;
  expect(estimateRun(keys, repeats)).toMatchObject({ attempts: 16 * repeats, estimatedCalls: 16 * repeats * 4 });
});
it('labels headers using frozen size and count even in a restricted report', () => {
  const body = assembleReport({ run: { id: 'r', status: 'passed', calls_used: 0, calls_budget: 384, size: 'quick', test_count: 16 }, conversations: [], findings: [], messages: [] });
  expect(suiteLabel(body, 'en')).toBe('Quick check, 16 tests');
  expect(suiteLabel(body, 'ar')).toBe('فحص سريع، 16 اختبارا');
  expect(suiteLabel({ ...body, run: { ...body.run, size: 'full', test_count: 48 } }, 'en')).toBe('Full suite, 48 tests');
});
