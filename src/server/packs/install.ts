import 'server-only';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Forbidden } from '../http/errors';
import { loadInlineCases } from './load';
import { runtimeForPack } from './runtime';
import { shopToolManifest } from '../../sandbox/shop/tools';
import { estateToolManifest } from '../../sandbox/real-estate/tools';
import { clinicToolManifest } from '../../sandbox/clinic/tools';
import { schoolToolManifest } from '../../sandbox/school/tools';

const manifests: Record<string, unknown> = { real_estate: estateToolManifest, ecommerce: shopToolManifest, clinics: clinicToolManifest, schools: schoolToolManifest };
/**
 * Adds a live pack to the workspace: its fictional agent with the baseline and planted versions, and its cases as drafts.
 * Stable keys carry the pack prefix so they never meet a Government key. Matching content is reused, never updated.
 */
export async function installPack(driver: TransactionDriver, memberId: string, packId: string, cwd = process.cwd()) {
  const runtime = runtimeForPack(packId);
  if (!runtime || runtime.pack.status !== 'live') throw new Forbidden();
  const cases = await loadInlineCases(packId, cwd);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'agent.write');
    await requireRole(sql, 'scenario.write');
    await sql.query("SELECT pg_advisory_xact_lock(hashtext(nazir.current_workspace_id()::text || ':pack:' || $1))", [packId]);
    const name = `${runtime.pack.name.en} demo agent`;
    let agent = (await sql.query<{ id: string }>('SELECT id FROM nazir.agents WHERE name=$1 ORDER BY created_at,id LIMIT 1', [name])).rows[0]?.id;
    if (!agent) {
      agent = (await sql.query<{ id: string }>('INSERT INTO nazir.agents(workspace_id,name) VALUES(nazir.current_workspace_id(),$1) RETURNING id', [name])).rows[0]!.id;
      // The adapter row is a supplier record; an owner without that role installs the agent and versions only.
      if ((await sql.query<{ ok: boolean }>("SELECT nazir.member_has_role('supplier_maintainer') AS ok")).rows[0]?.ok) await sql.query("INSERT INTO nazir.adapters(workspace_id,agent_id,kind,tool_manifest) VALUES(nazir.current_workspace_id(),$1,'built_in',$2)", [agent, JSON.stringify(manifests[packId])]);
    }
    const versionIds: Record<string, string> = {};
    for (const v of runtime.versions) {
      const config = { registry_id: v.id, pack_config_hash: v.configHash };
      let id = (await sql.query<{ id: string }>('SELECT id FROM nazir.agent_versions WHERE agent_id=$1 AND config=$2::jsonb', [agent, JSON.stringify(config)])).rows[0]?.id;
      if (!id) id = (await sql.query<{ id: string }>('INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,fault_label,config,frozen_at) VALUES(nazir.current_workspace_id(),$1,$2,$3,$4,$5::jsonb,now()) RETURNING id', [agent, v.label, v.kind, v.kind === 'planted_fault' ? v.disclosure.en : null, JSON.stringify(config)])).rows[0]!.id;
      versionIds[v.id] = id;
    }
    const scenarioIds: string[] = [];
    for (const c of cases) {
      const key = runtime.prefix + c.stable_key;
      const canonical = { pack: packId, meaning_key: key, kind: c.kind, outcome: c.expected.outcome, content_hash: c.content_hash };
      const previous = (await sql.query<{ id: string; version: number; library_hash: string }>('SELECT id,version,library_hash FROM nazir.scenarios WHERE stable_key=$1 ORDER BY version DESC LIMIT 1', [key])).rows[0];
      if (previous?.library_hash === c.content_hash) { scenarioIds.push(previous.id); continue; }
      let meaning = (await sql.query<{ id: string }>('SELECT id FROM nazir.scenario_meanings WHERE canonical=$1::jsonb AND family=$2', [JSON.stringify(canonical), c.family])).rows[0]?.id;
      if (!meaning) meaning = (await sql.query<{ id: string }>('INSERT INTO nazir.scenario_meanings(workspace_id,family,canonical) VALUES(nazir.current_workspace_id(),$1,$2::jsonb) RETURNING id', [c.family, JSON.stringify(canonical)])).rows[0]!.id;
      const row = (await sql.query<{ id: string }>(`INSERT INTO nazir.scenarios(workspace_id,meaning_id,stable_key,version,family,language,split,persona,starting_state,allowed_actions,forbidden_actions,expected_state,source_clause,expectation_kind,severity,rubric_version,resident_turns,checks,source,library_hash)
        VALUES(nazir.current_workspace_id(),$1,$2,$3,$4,$5,'development',$6::jsonb,$7::jsonb,$8,'{}',$9::jsonb,$10,$16,$11,$12,$13::jsonb,$14,'authored',$15) RETURNING id`,
      [meaning, key, (previous?.version ?? 0) + 1, c.family, c.language, JSON.stringify({ ...c.persona, resident_turns: c.resident_turns }), JSON.stringify(c.starting_state), [...runtime.toolNames], JSON.stringify(c.expected), c.source_clause, c.severity, runtime.pack.judge.rubric_version, JSON.stringify(c.resident_turns), c.checks, c.content_hash, c.expected.assessment ? c.expected.assessment.rubric_tags.includes('practice') ? 'approved_internal_rule' : 'public_fact' : 'fictional_demo_rule'])).rows[0]!;
      scenarioIds.push(row.id);
    }
    await sql.query("SELECT nazir.append_audit('pack.install','scenario',null,$1::jsonb)", [JSON.stringify({ pack: packId, scenarios: scenarioIds.length, versions: Object.keys(versionIds).length })]);
    return { agentId: agent, versionIds, scenarioIds };
  });
}
/** A second member approves the drafts, the same four eyes rule as any scenario. */
export async function approvePackCases(driver: TransactionDriver, memberId: string, packId: string) {
  const runtime = runtimeForPack(packId);
  if (!runtime) throw new Forbidden();
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'scenario.approve');
    const ids = (await sql.query<{ id: string }>("UPDATE nazir.scenarios SET status='approved',approved_by=nazir.current_member_id(),approved_at=now() WHERE status='draft' AND nazir.scenario_pack(starting_state)=$1 AND created_by IS DISTINCT FROM nazir.current_member_id() RETURNING id", [packId])).rows.map((r) => r.id);
    if (ids.length) await sql.query("SELECT nazir.append_audit('scenario.approve','scenario',null,$1::jsonb)", [JSON.stringify({ pack: packId, count: ids.length })]);
    return ids;
  });
}
