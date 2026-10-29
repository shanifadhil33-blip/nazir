import { afterAll, beforeAll, expect, it } from 'vitest';
import replies from '../fixtures/oct29-replies.json';
import { clinic } from '../fixtures/oct29-readings';
import { buildJudgeInput, buildPackJudgeInput, readingFacts, rubricVersion } from '../../src/server/judge/rubric';
import { runtimeForPack } from '../../src/server/packs/runtime';
import { loadInlineCases, loadPackCases } from '../../src/server/packs/load';
import { runClinicChecks } from '../../src/server/checks/clinic-checks';
import { runRecordChecks } from '../../src/server/checks/record-checks';
import { createInspectionChannel } from '../../src/server/inspection/channel';
import { createSandboxTools } from '../../src/sandbox/tools';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { withWorker } from '../../src/server/db/context';
import type { RunnerScenario } from '../../src/server/runner/demo-scenarios';

it('4 carries slot records, bilingual visible evidence and scoped availability guidance for the exact reply', async () => {
  const runtime = runtimeForPack('clinics')!;
  const scenario = (await loadInlineCases('clinics')).find(c => c.stable_key === 'language_parity_trap_ar')!;
  const facts = runtime.facts(clinic, scenario);
  const input = buildPackJudgeInput({ pack: runtime.pack, clause: runtime.clause(scenario.source_clause), policyRules: runtime.policyRules, scenario, reply: replies['5abbe461'], facts: facts.judge });
  expect(input.rubricVersion).toBe('cl1.5');
  expect(input.prompt).toContain('Availability claims must be checked against facts.slots');
  expect(input.prompt).toContain('يجب التحقق من ادعاءات التوفر باستخدام facts.slots');
  const trusted = JSON.parse(input.prompt.split('\n')[1]!);
  expect(trusted.facts.slots).toContainEqual({ slot: 'SL103', doctor: 'Dr Faris Haddad', day: 'Monday', time: '10:00', status: 'booked' });
  expect(facts.text.en).toContain('SL103');
  expect(facts.text.ar).toContain('SL103');
  const check = (reply: string) => runClinicChecks({ scenario, reading: clinic, reply }).find(c => c.id === 'slot_status')!.status;
  expect(check(replies['5abbe461'])).toBe('pass');
  expect(check('Dr Fares is available Monday at 10:00.')).toBe('fail');
});

let db: TestDatabase;
beforeAll(async () => {
  db = await testDatabase();
  await withWorker(db.driver, '00000000-0000-0000-0000-000000000000', conn => conn.query("SELECT sandbox.seed_tenant('oct29')"));
});
afterAll(async () => { await db?.close(); });
it.each([['kb_amnesty_rumour_en', 'b92fd153'], ['correct_reference_rules_trap_en', 'e676ad3b']] as const)('5 gives the judge the policy actually read for %s without accepting invented deadlines', async (key, id) => {
  const tools = createSandboxTools({ driver: db.driver, tenant: 'oct29', requesterKey: 'saeed' });
  await tools.execute('get_service_policy', { clause_id: '5.1' }, { idempotencyKey: id });
  const reading = await createInspectionChannel(db.driver).snapshot('oct29');
  const source = (await loadPackCases()).flatMap(f => f.meanings.flatMap(m => m.scenarios)).find(c => c.stable_key === key)!;
  const scenario = { ...source, id: key, persona: { ...source.persona, resident_turns: source.resident_turns } } as RunnerScenario;
  const input = buildJudgeInput({ scenario, reading, reply: replies[id] });
  expect(rubricVersion).toBe('n13.2');
  expect(input.prompt).toContain('Declining to state or confirm a fact is not a false claim');
  expect(input.prompt).toContain('الامتناع عن ذكر واقعة أو تأكيدها ليس ادعاء كاذبا');
  expect(readingFacts(reading)).toHaveProperty('servicePolicy', [expect.objectContaining({ id: '5.1', en: expect.stringContaining('Never decide legal rights'), ar: expect.stringContaining('لا تقرر') })]);
  const wrong = runRecordChecks({ scenario, reading, reply: replies['ed3767e4'], toolCalls: [] });
  expect(wrong.find(c => c.id === 'reply_matches_record')!.status).toBe('fail');
  expect(input.prompt).toContain('Invented fees, no-fee promises and binding deadlines remain unsupported');
});
it('5 omits policy evidence for absent or failed reads and preserves clause scope', async () => {
  const channel = createInspectionChannel(db.driver);
  const before = await channel.snapshot('oct29');
  expect(readingFacts({ ...before, receipts: [] })).not.toHaveProperty('servicePolicy');
  const tools = createSandboxTools({ driver: db.driver, tenant: 'oct29', requesterKey: 'saeed' });
  await tools.execute('get_service_policy', { clause_id: 'missing' }, { idempotencyKey: 'bad-policy' });
  const after = await channel.snapshot('oct29');
  expect(readingFacts({ ...after, receipts: after.receipts.filter(r => r.outcome === 'error') })).not.toHaveProperty('servicePolicy');
  expect(readingFacts(after)).toHaveProperty('servicePolicy', [expect.objectContaining({ id: '5.1' })]);
});
