import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { createLibraryFixture } from '../../src/server/runner/library-fixture';
import { installPack, approvePackCases } from '../../src/server/packs/install';
import { saveAgentSettings } from '../../src/server/settings/agent-settings';
import { proposeBoundedPlan, startBoundedRun } from '../../src/server/planner/bound';
import { approvePlan } from '../../src/server/memory/planner';
import { agentChat } from '../../src/server/agent/chat';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { cancelRun } from '../../src/server/runner/cancel';
import { createReport, readFullReport } from '../../src/server/reports/read';
import { Forbidden } from '../../src/server/http/errors';

let db: TestDatabase;
let fixture: Awaited<ReturnType<typeof createLibraryFixture>>;
beforeAll(async () => { db = await testDatabase(); fixture = await db.driver.transaction(createLibraryFixture); }, 60000);
afterAll(async () => { vi.unstubAllEnvs(); await db?.close(); });

it('uses the same chat, planning, approval, provider manifest and enqueue path for demo and real workspaces in every pack', async () => {
  // No worker or network provider is called. These are genuine queued conversations.
  vi.stubEnv('AI_DAILY_CAP_TEST_RUN', '2000');
  const { workspaceId, members } = fixture;
  const viewer = await db.createMember(workspaceId, ['viewer']);
  for (const pack of ['government', 'real_estate', 'ecommerce', 'clinics', 'schools']) {
    if (pack !== 'government') {
      await installPack(db.driver, members.author, pack);
      await approvePackCases(db.driver, members.reviewer, pack);
    }
    await saveAgentSettings(db.driver, members.author, { name: 'Quick tests', instructions: '', language: 'en', avatar: 'preset:1', focus_pack: pack });
    const rulesId = (await db.owner.query<{ rule_pack_version_id: string }>('SELECT rule_pack_version_id FROM nazir.plans WHERE id=$1', [fixture.planId])).rows[0]!.rule_pack_version_id;
    const versionId = pack === 'government' ? fixture.versions[0]!.id : Object.values((await installPack(db.driver, members.author, pack)).versionIds)[0]!;
    const full = await proposeBoundedPlan(db.driver, members.author, { agent_version_id: versionId, rule_pack_version_id: rulesId, size: 'full' });
    expect(full.scenarioIds).toHaveLength(pack === 'schools' ? 64 : 58);
    expect(full.repeatCount).toBe(3);
    const manifests: Record<string, unknown>[] = [];
    for (const kind of ['demo', 'real']) {
      await db.owner.query('UPDATE nazir.workspaces SET kind=$2 WHERE id=$1', [workspaceId, kind]);
      if (kind === 'real') {
        const { saveExternalAgent, testExternalAgent } = await import('../../src/server/settings/external-agent');
        const resolve = async () => [{ address: '93.184.215.14' }];
        await saveExternalAgent(db.driver, members.author, { endpoint: 'https://agent.example.com/chat', format: 'simple_json' }, undefined, resolve);
        await testExternalAgent(db.driver, members.author, { message: 'Hello', language: 'en' }, { resolve, fetcher: async () => Response.json({ reply: 'Hello Omar' }) });
      }
      const proposed = await agentChat(db.driver, members.author, { message: kind === 'demo' ? 'run a quick check' : 'فحص سريع' }, null);
      expect(proposed.done).toBe(true);
      const plan = proposed.data as { id: string; scenarioIds: string[]; plannedCalls: number; size: string };
      expect(plan.size).toBe('quick');
      expect(plan.scenarioIds).toHaveLength(8);
      expect(plan.plannedCalls).toBe(8 * 1 * 8);
      const approval = { id: plan.id, reason: 'I reviewed these test cases.', evidence_opened: true, size: 'quick', repeat_count: 3 };
      await expect(approvePlan(db.driver, viewer, approval)).rejects.toBeInstanceOf(Forbidden);
      await expect(proposeBoundedPlan(db.driver, viewer, { agent_version_id: crypto.randomUUID(), rule_pack_version_id: crypto.randomUUID(), size: 'quick' })).rejects.toBeInstanceOf(Forbidden);
      await expect(approvePlan(db.driver, members.reviewer, { ...approval, size: 'invalid' })).rejects.toThrow();
      await approvePlan(db.driver, members.reviewer, approval);
      vi.stubEnv('AI_DAILY_CAP_TEST_RUN', '63');
      await expect(startBoundedRun(db.driver, members.reviewer, plan.id)).rejects.toMatchObject({ code: 'repeat_daily_cap', details: { attempts: 8, estimatedCalls: 64 } });
      vi.stubEnv('AI_DAILY_CAP_TEST_RUN', '2000');
      await expect(enqueueRun(db.driver, { workspaceId, planId: plan.id, agentVersionId: versionId, scenarioIds: full.scenarioIds.slice(0, 17), size: 'quick', repeats: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('exactly 8');
      const run = await startBoundedRun(db.driver, members.reviewer, plan.id);
      const rows = (await db.owner.query('SELECT language,attempt_number FROM nazir.conversations WHERE run_id=$1', [run.id])).rows;
      expect(rows).toHaveLength(8);
      expect(rows.filter((r) => r.language === 'ar')).toHaveLength(4);
      const manifest = (await db.owner.query<{ frozen_manifest: Record<string, unknown> }>('SELECT frozen_manifest FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!.frozen_manifest;
      expect(manifest).toMatchObject({ size: 'quick', testCount: 8, quickVersion: '2.0.0', repeatCount: 1, estimatedCalls: 64, recordsOnly: false });
      manifests.push(manifest);
      await cancelRun(db.driver, workspaceId, run.id);
      const report = await createReport(db.driver, members.reviewer, { run_id: run.id });
      expect((await readFullReport(db.driver, members.reviewer, report.id)).run).toMatchObject({ size: 'quick', test_count: 8 });
    }
    expect(manifests[0]).not.toHaveProperty('externalAgent');
    expect(manifests[1]!.externalAgent).toMatchObject({ scope: 'replies_only', name: 'agent.example.com' });
    const { externalAgent: connection, ...realManifest } = manifests[1]!;
    expect(connection).toBeDefined(); expect(manifests[0]).toEqual(realManifest);
  }
}, 120000);

it('keeps a frozen sixteen question three pass check while new Quick checks use eight and one', async () => {
  const { packById } = await import('../../src/server/packs/catalog');
  const { workspaceId, members } = fixture;
  await saveAgentSettings(db.driver, members.author, { name: 'Quick tests', instructions: '', language: 'en', avatar: 'preset:1', focus_pack: 'government' });
  const keys = packById('government')!.quick.previous![0]!.keys;
  const ids = keys.map((key) => fixture.scenarios[key]!);
  const legacyPlan = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,repeat_count,budget_calls,stop_rules,status,proposed_by_type)
    SELECT workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,3,3,384,$2::jsonb,'approved','nazir' FROM nazir.plans WHERE id=$1 RETURNING id`, [fixture.planId, JSON.stringify({ size: 'quick', quick_version: '1.0.0', calls_per_attempt: 8 })])).rows[0]!;
  const run = await enqueueRun(db.driver, { workspaceId, planId: legacyPlan.id, agentVersionId: fixture.versions[0]!.id, scenarioIds: ids, repeats: 3, idempotencyKey: crypto.randomUUID() });
  const before = (await db.owner.query('SELECT frozen_manifest,repeat_count FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!;
  expect(before).toMatchObject({ repeat_count: 3, frozen_manifest: { quickVersion: '1.0.0', testCount: 16, repeatCount: 3 } });
  expect((await db.owner.query('SELECT id FROM nazir.conversations WHERE run_id=$1', [run.id])).rows).toHaveLength(48);
  const rules = (await db.owner.query<{ rule_pack_version_id: string }>('SELECT rule_pack_version_id FROM nazir.plans WHERE id=$1', [fixture.planId])).rows[0]!.rule_pack_version_id;
  const fresh = await proposeBoundedPlan(db.driver, members.author, { agent_version_id: fixture.versions[0]!.id, rule_pack_version_id: rules, size: 'quick', repeat_count: 3 });
  expect(fresh).toMatchObject({ repeatCount: 1 }); expect(fresh.scenarioIds).toHaveLength(8);
  expect((await db.owner.query('SELECT frozen_manifest,repeat_count FROM nazir.runs WHERE id=$1', [run.id])).rows[0]).toEqual(before);
  await cancelRun(db.driver, workspaceId, run.id);
});
