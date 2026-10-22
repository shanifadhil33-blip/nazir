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
    const manifests: Record<string, unknown>[] = [];
    for (const kind of ['demo', 'real']) {
      await db.owner.query('UPDATE nazir.workspaces SET kind=$2 WHERE id=$1', [workspaceId, kind]);
      const proposed = await agentChat(db.driver, members.author, { message: kind === 'demo' ? 'run a quick check' : 'فحص سريع' }, null);
      expect(proposed.done).toBe(true);
      const plan = proposed.data as { id: string; scenarioIds: string[]; plannedCalls: number; size: string };
      expect(plan.size).toBe('quick');
      expect(plan.scenarioIds).toHaveLength(16);
      expect(plan.plannedCalls).toBe(16 * 3 * 8);
      const approval = { id: plan.id, reason: 'I reviewed these test cases.', evidence_opened: true, size: 'quick', repeat_count: 3 };
      await expect(approvePlan(db.driver, viewer, approval)).rejects.toBeInstanceOf(Forbidden);
      await expect(proposeBoundedPlan(db.driver, viewer, { agent_version_id: crypto.randomUUID(), rule_pack_version_id: crypto.randomUUID(), size: 'quick' })).rejects.toBeInstanceOf(Forbidden);
      await expect(approvePlan(db.driver, members.reviewer, { ...approval, size: 'invalid' })).rejects.toThrow();
      await approvePlan(db.driver, members.reviewer, approval);
      vi.stubEnv('AI_DAILY_CAP_TEST_RUN', '383');
      await expect(startBoundedRun(db.driver, members.reviewer, plan.id)).rejects.toMatchObject({ code: 'repeat_daily_cap', details: { attempts: 48, estimatedCalls: 384 } });
      vi.stubEnv('AI_DAILY_CAP_TEST_RUN', '2000');
      await expect(enqueueRun(db.driver, { workspaceId, planId: plan.id, agentVersionId: versionId, scenarioIds: full.scenarioIds.slice(0, 17), size: 'quick', repeats: 1, idempotencyKey: crypto.randomUUID() })).rejects.toThrow('exactly 16');
      const run = await startBoundedRun(db.driver, members.reviewer, plan.id);
      const rows = (await db.owner.query('SELECT language,attempt_number FROM nazir.conversations WHERE run_id=$1', [run.id])).rows;
      expect(rows).toHaveLength(48);
      expect(rows.filter((r) => r.language === 'ar')).toHaveLength(24);
      const manifest = (await db.owner.query<{ frozen_manifest: Record<string, unknown> }>('SELECT frozen_manifest FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!.frozen_manifest;
      expect(manifest).toMatchObject({ size: 'quick', testCount: 16, quickVersion: '1.0.0', repeatCount: 3, estimatedCalls: 384, recordsOnly: false });
      manifests.push(manifest);
      await cancelRun(db.driver, workspaceId, run.id);
      const report = await createReport(db.driver, members.reviewer, { run_id: run.id });
      expect((await readFullReport(db.driver, members.reviewer, report.id)).run).toMatchObject({ size: 'quick', test_count: 16 });
    }
    expect(manifests[0]).toEqual(manifests[1]);
  }
}, 120000);
