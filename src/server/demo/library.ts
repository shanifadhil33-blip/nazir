import 'server-only';
import { demoRulePack } from '../../sandbox/demo-rule-pack';
import { agentVersions } from '../../sandbox/versions';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { approveScenario, importLibrary } from '../library/import';
import { approveRulePackVersion, draftRulePackVersion } from '../services/index';
import { loadPackCases } from '../packs/load';
import { demoWorkspaceId } from '../auth/demo';

const omar = 'd0000000-0000-4000-8000-000000000011';
const yusuf = 'd0000000-0000-4000-8000-000000000012';
const bilal = 'd0000000-0000-4000-8000-000000000014';

/**
 * What the demo workspace needs before a Quick check can start there, and before its history can point at real tests.
 * Written through the same member operations a team would use: the owner imports the Government tests and the drafts the rules,
 * the reviewer approves each test, the owner approves the rules. Nothing is approved by its own author. Safe to run twice.
 * The owner connection adds the two planted fault versions, older than the newest, so the demo agent shows real mistakes.
 */
export async function installDemoLibrary(owner: TransactionDriver, member: TransactionDriver) {
  const library = await loadPackCases('government');
  await owner.transaction(async (db: SqlConnection) => {
    await db.query('SELECT pg_advisory_xact_lock(710192029)');
    const have = (await db.query<{ registry: string }>("SELECT config->>'registry_id' AS registry FROM nazir.agent_versions WHERE workspace_id=$1", [demoWorkspaceId])).rows.map((r) => r.registry);
    const agent = (await db.query<{ id: string }>('SELECT id FROM nazir.agents WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 1', [demoWorkspaceId])).rows[0]!.id;
    for (const id of ['planted_false_submit', 'planted_wrong_queue'] as const) {
      if (have.includes(id)) continue;
      const v = agentVersions[id];
      await db.query('INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,fault_label,config,frozen_at,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,now(),$7,clock_timestamp()-$8::interval)', [demoWorkspaceId, agent, v.label, v.kind, v.disclosure.en, JSON.stringify({ registry_id: v.id }), omar, id === 'planted_false_submit' ? '1 minute' : '0 seconds']);
    }
    await db.query("INSERT INTO nazir.rule_packs(workspace_id,key,title) VALUES($1,'government_rules','Government service rules') ON CONFLICT(workspace_id,key) DO NOTHING", [demoWorkspaceId]);
  });
  const ruleVersion = await owner.transaction(async (db) => (await db.query<{ id: string; status: string }>("SELECT v.id,v.status FROM nazir.rule_pack_versions v JOIN nazir.rule_packs p ON p.id=v.rule_pack_id WHERE p.workspace_id=$1 AND p.key='government_rules' AND v.version=1", [demoWorkspaceId])).rows[0]);
  if (!ruleVersion) {
    const packId = await owner.transaction(async (db) => (await db.query<{ id: string }>("SELECT id FROM nazir.rule_packs WHERE workspace_id=$1 AND key='government_rules'", [demoWorkspaceId])).rows[0]!.id);
    // The supplier drafts the rules and the owner approves them, so nobody approves their own draft.
    const drafted = await draftRulePackVersion(member, bilal, { rule_pack_id: packId, version: 1, content: demoRulePack });
    await approveRulePackVersion(member, omar, { id: drafted.id, reason: 'Checked the rules against the Government service policy.', evidence_opened: true });
  }
  const ids = await importLibrary(member, omar, library);
  const drafts = await owner.transaction(async (db) => (await db.query<{ id: string }>("SELECT id FROM nazir.scenarios WHERE workspace_id=$1 AND library_hash IS NOT NULL AND status='draft'", [demoWorkspaceId])).rows.map((r) => r.id));
  for (const id of drafts) await approveScenario(member, yusuf, id);
  return { scenarios: ids.length, approved: drafts.length, rulesDrafted: !ruleVersion };
}
