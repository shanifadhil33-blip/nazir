import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { estateReferenceModel } from '../helpers/estate-reference';
import { schoolReferenceModel } from '../helpers/school-reference';
import { clinicReferenceModel } from '../helpers/clinic-reference';
import { shopReferenceModel } from '../helpers/shop-reference';
import { semantic } from '../judge/helpers';
import { installPack, approvePackCases } from '../../src/server/packs/install';
import { packRuntimes, caseFromRow } from '../../src/server/packs/runtime';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { runNextConversation } from '../../src/server/runner/worker';
import { planInputs } from '../../src/server/memory/planner';
import { withWorker } from '../../src/server/db/context';
import { saveAgentSettings } from '../../src/server/settings/agent-settings';
import { checkFindingComplete } from '../../src/server/findings/probe';
import { judgePromptHash, rubricVersion, buildJudgeInput } from '../../src/server/judge/rubric';
import type { InlineCase } from '../../src/server/packs/schema';
import type { ChatModel } from '../../src/sandbox/agent';

let db: TestDatabase; let owner: string; let reviewer: string; let workspace: string; let plan: string;
const installed: Record<string, Awaited<ReturnType<typeof installPack>>> = {};
const base = { name: 'Amal Desk', instructions: '', language: 'en', avatar: 'preset:2' };
const prompts: { prompt: string; rubricVersion?: string }[] = [];
beforeAll(async () => {
  db = await testDatabase();
  const identity = await db.bootstrap('Packs');
  owner = identity.member_id; workspace = identity.workspace_id;
  reviewer = await db.createMember(workspace, ['quality_reviewer'], 'Khalid Hamdan');
  for (const pack of ['real_estate', 'ecommerce', 'clinics', 'schools']) { installed[pack] = await installPack(db.driver, owner, pack); expect(await approvePackCases(db.driver, owner, pack)).toEqual([]); expect(await approvePackCases(db.driver, reviewer, pack)).toHaveLength(pack === 'schools' ? 64 : 58); }
  const rp = (await db.owner.query<{ id: string }>("INSERT INTO nazir.rule_packs(workspace_id,key,title) VALUES($1,'packs','Fictional pack rules') RETURNING id", [workspace])).rows[0]!.id;
  const rules = (await db.owner.query<{ id: string }>("INSERT INTO nazir.rule_pack_versions(workspace_id,rule_pack_id,version,content,status) VALUES($1,$2,1,'{}','approved') RETURNING id", [workspace, rp])).rows[0]!.id;
  plan = (await db.owner.query<{ id: string }>("INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,status,proposed_by_type) VALUES($1,'Pack runs',$2,$3,'{}','{en,ar}',1,2000,'{}','approved','nazir') RETURNING id", [workspace, installed.real_estate!.versionIds.estate_baseline, rules])).rows[0]!.id;
}, 120000);
afterAll(async () => { await db?.close(); });

async function scenarios(pack: string) {
  return (await db.owner.query<Record<string, unknown>>("SELECT s.*,m.canonical FROM nazir.scenarios s JOIN nazir.scenario_meanings m ON m.id=s.meaning_id WHERE s.workspace_id=$1 AND nazir.scenario_pack(s.starting_state)=$2 ORDER BY s.stable_key", [workspace, pack])).rows;
}
async function run(scenarioId: string, versionId: string, model: ChatModel, recordsOnly = false) {
  const r = await enqueueRun(db.driver, { workspaceId: workspace, planId: plan, agentVersionId: versionId, scenarioIds: [scenarioId], repeats: 1, idempotencyKey: crypto.randomUUID(), recordsOnly });
  await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'pack_worker', runId: r.id, chatModelFactory: () => model, judgeFactory: () => async ({ input }) => { prompts.push(input); return { ...semantic('supported', input.reply), rubricVersion: (input as { rubricVersion?: string }).rubricVersion ?? rubricVersion }; } });
  const conversation = (await db.owner.query<Record<string, unknown>>('SELECT * FROM nazir.conversations WHERE run_id=$1', [r.id])).rows[0]!;
  const findings = (await db.owner.query<Record<string, unknown>>('SELECT * FROM nazir.findings WHERE conversation_id=$1', [conversation.id])).rows;
  const manifest = (await db.owner.query<{ frozen_manifest: Record<string, unknown> }>('SELECT frozen_manifest FROM nazir.runs WHERE id=$1', [r.id])).rows[0]!.frozen_manifest;
  return { conversation, findings, manifest };
}

it('installs each pack once, with prefixed keys that never meet Government', async () => {
  const again = await installPack(db.driver, owner, 'real_estate');
  expect(again.scenarioIds).toEqual(installed.real_estate!.scenarioIds);
  expect(Object.keys(installed.ecommerce!.versionIds)).toEqual(['shop_baseline', 'shop_planted_stale_status', 'shop_planted_refund_overpay', 'shop_planted_duplicate_request']);
  expect((await scenarios('real_estate')).every((s) => String(s.stable_key).startsWith('re_'))).toBe(true);
  expect((await scenarios('ecommerce')).every((s) => String(s.stable_key).startsWith('ec_'))).toBe(true);
  expect(Object.keys(installed.clinics!.versionIds)).toEqual(['clinic_baseline', 'clinic_planted_dosing_advice', 'clinic_planted_guessed_coverage', 'clinic_planted_unavailable_slot']);
  expect((await scenarios('clinics')).every((s) => String(s.stable_key).startsWith('cl_'))).toBe(true);
  expect(Object.keys(installed.schools!.versionIds)).toEqual(['school_baseline', 'school_planted_skip_guardian_check', 'school_planted_full_grade_seat', 'school_planted_misrouted_safeguarding']);
  expect((await scenarios('schools')).every((s) => String(s.stable_key).startsWith('sc_'))).toBe(true);
});

it('plans only the cases of the chosen focus pack', async () => {
  const count = async () => withWorker(db.driver, workspace, async (sql) => (await planInputs(sql)).scenarios.map((s) => s.stable_key));
  expect(await count()).toEqual([]);
  await saveAgentSettings(db.driver, owner, { ...base, focus_pack: 'real_estate' });
  const estate = await count();
  expect(estate).toHaveLength(58);
  expect(estate.every((k) => k.startsWith('re_'))).toBe(true);
  await saveAgentSettings(db.driver, owner, { ...base, focus_pack: 'ecommerce' });
  expect((await count()).every((k) => k.startsWith('ec_'))).toBe(true);
  await saveAgentSettings(db.driver, owner, { ...base, focus_pack: 'government' });
});

for (const [pack, model, baseline] of [['real_estate', estateReferenceModel, 'estate_baseline'], ['ecommerce', shopReferenceModel, 'shop_baseline'], ['clinics', clinicReferenceModel, 'clinic_baseline'], ['schools', schoolReferenceModel, 'school_baseline']] as const) {
  it(`runs all ${pack} full suite cases through the real worker with a scripted agent and passes them`, async () => {
    const failed: string[] = [];
    for (const row of await scenarios(pack)) {
      const c: InlineCase = caseFromRow(row);
      const { conversation, findings } = await run(String(row.id), installed[pack]!.versionIds[baseline]!, model(c));
      if (conversation.status !== 'passed') failed.push(`${row.stable_key} ${conversation.status} ${conversation.inconclusive_reason ?? ''} ${JSON.stringify((conversation.result_summary as { records?: unknown })?.records)}`);
      expect(findings).toEqual([]);
    }
    expect(failed).toEqual([]);
  }, 240000);
}

it('judges a pack reply with the pack rubric and version, and keeps Government prompts unchanged', async () => {
  const estatePrompt = prompts.find((p) => p.rubricVersion === 're1.2')!;
  expect(estatePrompt.prompt).toContain('approved leasing rules');
  expect(estatePrompt.prompt).not.toContain('Judge whether the reply is supported by the service rule and records.');
  expect(prompts.some((p) => p.rubricVersion === 'ec1.2' && p.prompt.includes('store policy'))).toBe(true);
  expect(prompts.some((p) => p.rubricVersion === 'sc1.2')).toBe(true);
  for (const runtime of packRuntimes) {
    const inputs = prompts.filter((p) => p.rubricVersion === runtime.pack.judge.rubric_version);
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const context = JSON.parse(input.prompt.split('\n')[1]!);
      const language = context.language === 'ar' ? 'ar' : 'en';
      expect(context.approvedPolicyRules).toEqual(runtime.policyRules.map((r) => ({ id: r.id, text: r[language] })));
    }
  }
  // Government: same rubric version, prompt hash and no pack field.
  expect(rubricVersion).toBe('n13.1');
  expect(judgePromptHash).toBe(GOVERNMENT_PROMPT_HASH);
  const gov = buildJudgeInput({ scenario: { language: 'en', source_clause: '3.1', expected_state: {}, persona: { resident_turns: ['x'] } } as never, reply: 'ok', reading: { cases: [], receipts: [] } as never });
  expect(gov).not.toHaveProperty('rubricVersion');
});

it('fails a planted fault with a complete finding and pins the pack in the manifest', async () => {
  const pick = async (pack: string, key: string) => (await scenarios(pack)).find((s) => s.stable_key === key)!;
  const estate = await pick('real_estate', 're_viewing_booking_normal_en');
  const wrong = await run(String(estate.id), installed.real_estate!.versionIds.estate_planted_wrong_agent!, estateReferenceModel(caseFromRow(estate)));
  expect(wrong.conversation.status).toBe('failed');
  expect(wrong.manifest).toMatchObject({ pack: 'real_estate', rubricVersion: 're1.2', registry_id: 'estate_planted_wrong_agent' });
  const finding = wrong.findings.find((f) => f.check_id === 'assigned_agent')!;
  expect(checkFindingComplete(finding)).toEqual([]);
  expect(finding.root_cause_class).toBe('workflow_failure');
  const shop = await pick('ecommerce', 'ec_refund_request_normal_ar');
  const over = await run(String(shop.id), installed.ecommerce!.versionIds.shop_planted_refund_overpay!, shopReferenceModel(caseFromRow(shop)), true);
  expect(over.conversation.status).toBe('failed');
  const refund = over.findings.find((f) => f.check_id === 'refund_amount')!;
  expect(checkFindingComplete(refund)).toEqual([]);
  expect(refund.title_ar).toBe('الاسترجاع ضمن المبلغ المدفوع');
  expect(String(refund.really_happened_ar)).toContain('OR1002');
  const school = await pick('schools', 'sc_safeguarding_normal_en');
  const misrouted = await run(String(school.id), installed.schools!.versionIds.school_planted_misrouted_safeguarding!, schoolReferenceModel(caseFromRow(school)), true);
  expect(misrouted.conversation.status).toBe('failed');
  expect(misrouted.manifest).toMatchObject({ pack: 'schools', rubricVersion: 'sc1.2', registry_id: 'school_planted_misrouted_safeguarding' });
  expect(checkFindingComplete(misrouted.findings.find((f) => f.check_id === 'linked_escalation')!)).toEqual([]);
});

it('refuses to mix a pack version with another pack cases', async () => {
  const shop = (await scenarios('ecommerce'))[0]!;
  await expect(enqueueRun(db.driver, { workspaceId: workspace, planId: plan, agentVersionId: installed.real_estate!.versionIds.estate_baseline!, scenarioIds: [String(shop.id)], repeats: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('another focus pack');
});
// Computed on main before this change (68249eb).
const GOVERNMENT_PROMPT_HASH = '7ec53a78c921f04281fed06dc93e4a4c6b1909626cd12322bb9c8fa8f38140df';

it('persists guard tool provenance and a low severity finding while linked escalation passes', async () => {
  const row = (await scenarios('clinics')).find((s) => s.stable_key === 'cl_lab_results_trap_ar')!;
  const result = await run(String(row.id), installed.clinics!.versionIds.clinic_baseline!, async () => ({ content: 'لا أستطيع تفسير نتائج التحاليل.' }), true);
  const events = (await db.owner.query<{ response: Record<string, unknown> }>('SELECT response FROM nazir.tool_events WHERE conversation_id=$1', [result.conversation.id])).rows;
  expect(events).toContainEqual({ response: expect.objectContaining({ guard: true, source: 'guard', ok: true }) });
  const records = (result.conversation.result_summary as { records: { id: string; status: string; severity: string; summary: { en: string } }[] }).records;
  expect(records.find((r) => r.id === 'linked_escalation')?.status).toBe('pass');
  expect(records).toContainEqual(expect.objectContaining({ severity: 'low', summary: expect.objectContaining({ en: 'escalation added by guard, model did not escalate' }) }));
  expect(result.findings).toContainEqual(expect.objectContaining({ severity: 'low', title: 'escalation added by guard, model did not escalate', evidence: expect.objectContaining({ receipts: expect.arrayContaining([expect.objectContaining({ guard: true })]) }) }));
});

it.each(['ecommerce', 'schools'])('marks truncated %s replies and every record check inconclusive', async (pack) => {
  const key = pack === 'ecommerce' ? 'ec_return_window_trap_ar' : 'sc_safeguarding_normal_en';
  const row = (await scenarios(pack)).find((s) => s.stable_key === key)!;
  const reply = 'عذراً، طلبك OR1004 تم تسليمه في 11 سبتمبر 20';
  const promptCount = prompts.length;
  const { conversation, findings } = await run(String(row.id), installed[pack]!.versionIds[pack === 'ecommerce' ? 'shop_baseline' : 'school_baseline']!, async () => ({ content: reply, truncated: true }));
  expect(conversation.status).toBe('inconclusive');
  expect(conversation.inconclusive_reason).toBe('agent_reply_cut_off');
  const summary = conversation.result_summary as { records: { status: string; summary: { en: string; ar: string } }[] };
  expect(summary.records.length).toBeGreaterThan(0);
  for (const check of summary.records) expect(check).toMatchObject({ status: 'inconclusive', summary: { en: 'Agent reply cut off', ar: 'انقطع رد الوكيل' } });
  expect(findings).toEqual([]);
  expect(prompts).toHaveLength(promptCount);
  const messages = (await db.owner.query<{ body: string }>("SELECT body FROM nazir.conversation_messages WHERE conversation_id=$1 AND speaker='agent'", [conversation.id])).rows;
  expect(messages.map((m) => m.body)).toEqual([reply]);
  expect((await db.owner.query('SELECT * FROM nazir.tool_events WHERE conversation_id=$1', [conversation.id])).rows).toEqual([]);
});
