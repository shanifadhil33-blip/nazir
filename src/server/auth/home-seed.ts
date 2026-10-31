import 'server-only';
import type { SqlConnection } from '../db/driver';
import { requireRole } from './guard';
import { baselineVersion } from '../../sandbox/versions';

/** The Focus Pack a new home workspace starts with. */
export const homeFocusPack = 'government';
/** The built in Government sample agent, the same one the runner fixture uses. */
export const sampleAgentName = 'Fictional Service Agent';

/**
 * Runs inside the sign in transaction, under the per user lock, as the new service owner.
 * Switches to the app role so row level security and role triggers apply as for any member write.
 * Adds the sample agent with its baseline version and records the Government Focus Pack; anything already present is reused.
 * Only the baseline is added, so the planner never picks a planted fault for a first Quick check.
 */
export async function seedHomeWorkspace(sql: SqlConnection, memberId: string) {
  await sql.query('SET LOCAL ROLE nazir_app');
  await sql.query("SELECT set_config('app.member_id', $1, true)", [memberId]);
  await requireRole(sql, 'agent.write');
  let agent = (await sql.query<{ id: string }>('SELECT id FROM nazir.agents WHERE name=$1 ORDER BY created_at,id LIMIT 1', [sampleAgentName])).rows[0]?.id;
  const created = !agent;
  if (!agent) agent = (await sql.query<{ id: string }>('INSERT INTO nazir.agents(workspace_id,name) VALUES(nazir.current_workspace_id(),$1) RETURNING id', [sampleAgentName])).rows[0]!.id;
  const config = { registry_id: baselineVersion.id };
  const version = (await sql.query<{ id: string }>('SELECT id FROM nazir.agent_versions WHERE agent_id=$1 AND config=$2::jsonb', [agent, JSON.stringify(config)])).rows[0]?.id;
  if (!version) {
    await sql.query('INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config,frozen_at) VALUES(nazir.current_workspace_id(),$1,$2,$3,$4::jsonb,now())',
      [agent, baselineVersion.label, baselineVersion.kind, JSON.stringify(config)]);
  }
  if (created) {
    // A brand new workspace has no saved settings yet, so this writes the defaults with the Government pack recorded.
    await sql.query('SELECT nazir.save_agent_settings($1::jsonb,NULL,NULL,false)', [JSON.stringify({ name: '', instructions: '', language: 'en', avatar: 'preset:1', focus_pack: homeFocusPack, mcp_servers: [], integrations: [], llm_provider: '', llm_model: '', llm_base_url: '' })]);
    await sql.query("SELECT nazir.append_audit('workspace.seeded','agent',$1,$2::jsonb)", [agent, JSON.stringify({ focus_pack: homeFocusPack, version: baselineVersion.id })]);
  }
  return { agentId: agent, focusPack: homeFocusPack };
}
