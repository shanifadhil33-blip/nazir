import 'server-only';
import type { SqlConnection } from '../db/driver';
import { agentVersions } from '../../sandbox/versions';
import { demoRulePack } from '../../sandbox/demo-rule-pack';
import { toolManifest } from '../../sandbox/tools';
import { demoScenarios } from './demo-scenarios';
// Administration fixture only. The caller supplies one owner transaction.
export async function createRunnerFixture(db: SqlConnection, label='Nazir runner fixture', options: { includeComplaintScenarios?: boolean } = {}) {
  await db.query('SELECT pg_advisory_xact_lock(710192028)');
  const prior=(await db.query<{ id: string }>('SELECT id FROM nazir.workspaces WHERE name=$1',[label])).rows[0];
  let wid=prior?.id;
  if (!wid) {
    await db.query('SET LOCAL ROLE nazir_worker');
    wid=(await db.query<{ workspace_id: string }>("SELECT * FROM nazir.bootstrap_workspace($1,'Omar Mansoor',$2,'demo')",['runner_'+label.replace(/[^a-z0-9]/gi,'').toLowerCase()+'@example.test',label])).rows[0]!.workspace_id;
    await db.query('RESET ROLE');
  }
  async function insert(table: string,values: Record<string,unknown>) {
    const fields={ workspace_id:wid,...values },params=Object.values(fields).map((v) => v!==null && typeof v==='object' && !Array.isArray(v)?JSON.stringify(v):v);
    return (await db.query<{ id: string }>(`INSERT INTO nazir.${table}(${Object.keys(fields).join(',')}) VALUES(${params.map((_,i) => '$'+(i+1)).join(',')}) RETURNING id`,params)).rows[0]!.id;
  }
  const existing=(await db.query<{ id: string }>('SELECT id FROM nazir.plans WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 1',[wid])).rows[0];
  if (!existing) {
    const pack=await insert('rule_packs',{ key:'runner_demo',title:'Fictional complaint rules' });
    const rules=await insert('rule_pack_versions',{ rule_pack_id:pack,version:1,content:demoRulePack,status:'approved' });
    const agent=await insert('agents',{ name:'Fictional Service Agent' });
    let baseline='';
    for (const v of Object.values(agentVersions)) {
      const id=await insert('agent_versions',{ agent_id:agent,label:v.label,kind:v.kind,fault_label:v.kind==='planted_fault'?v.disclosure.en:null,config:{ registry_id:v.id },frozen_at:new Date().toISOString() });
      if (v.id==='baseline') baseline=id;
    }
    await insert('adapters',{ agent_id:agent,kind:'built_in',tool_manifest:JSON.stringify(toolManifest) });
    const meaning=await insert('scenario_meanings',{ family:'complaint',canonical:{ category:'complaint',review:true } });
    const seeded = options.includeComplaintScenarios === false ? [] : demoScenarios;
    for (const s of seeded) await insert('scenarios',{ meaning_id:meaning,stable_key:s.stable_key,version:1,family:'complaint',language:s.language,split:'development',persona:{ requester_key:s.requester_key,resident_turns:s.resident_turns },starting_state:{},allowed_actions:['create_case','get_case_status','request_human_review'],forbidden_actions:[],expected_state:s.expected_state,source_clause:'3.1',expectation_kind:'fictional_demo_rule',severity:'high',rubric_version:'1',status:'approved' });
    await insert('plans',{ goal:'Run fictional complaints',agent_version_id:baseline,rule_pack_version_id:rules,families:['complaint'],languages:['en','ar'],repeats:1,budget_calls:60,stop_rules:{ records_only:true },status:'approved',proposed_by_type:'nazir' });
  }
  const versions=(await db.query<{ id: string; registry_id: string }>("SELECT id,config->>'registry_id' AS registry_id FROM nazir.agent_versions WHERE workspace_id=$1",[wid])).rows;
  const scenarios=(await db.query<{ id: string; language: string }>('SELECT id,language FROM nazir.scenarios WHERE workspace_id=$1 ORDER BY language',[wid])).rows;
  const plan=(await db.query<{ id: string }>('SELECT id FROM nazir.plans WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 1',[wid])).rows[0]!;
  return { workspaceId:wid,planId:plan.id,versions,scenarios };
}
