import type { FrozenLesson } from '../memory/frozen';
import 'server-only';
import { withWorker } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { resolveExecutable } from '../repair/executable';
import { hash, rulePackHash } from '../../sandbox/demo-rule-pack';
import { chainOrder, providerRegistry } from '../ai/providers';
import { rubricVersion, judgePromptHash } from '../judge/rubric';
export const runnerVersion = 'n13';
// The manifest shape version. runner_version stays n13 because migration 0012 triggers key on it.
export const manifestVersion = 'n15';
export async function enqueueRun(driver: TransactionDriver, input: { workspaceId: string; planId: string; agentVersionId: string; scenarioIds: string[]; repeats: number; idempotencyKey: string; recordsOnly?: boolean; order?: string[]; repeatsFor?: Record<string, number>; lessons?: FrozenLesson[] }) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length>200 || !Number.isInteger(input.repeats) || input.repeats<1 || input.repeats>100 || !input.scenarioIds.length || new Set(input.scenarioIds).size!==input.scenarioIds.length || Object.values(input.repeatsFor ?? {}).some((n) => !Number.isInteger(n) || n<1 || n>100) || (input.order && input.order.some((id) => !input.scenarioIds.includes(id)))) throw new Error('Invalid enqueue');
  return withWorker(driver,input.workspaceId,async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.workspaceId+':'+input.idempotencyKey]);
    const existing = (await db.query<{ id: string }>('SELECT id FROM nazir.runs WHERE idempotency_key=$1',[input.idempotencyKey])).rows[0];
    if (existing) return existing;
    const plan = (await db.query<{ rule_pack_version_id: string; budget_calls: number; stop_rules: { records_only?: boolean } }>("SELECT rule_pack_version_id,budget_calls,stop_rules FROM nazir.plans WHERE id=$1 AND status='approved'",[input.planId])).rows[0];
    if (!plan) throw new Error('Approved plan required');
    const row = (await db.query<{ config: { registry_id: string; parent_registry_id?: string; patch?: unknown; executable_hash?: string }; config_hash: string }>('SELECT config,config_hash FROM nazir.agent_versions WHERE id=$1',[input.agentVersionId])).rows[0];
    const version = row && resolveExecutable(row.config);
    if (!version || row.config_hash!==version.configHash) throw new Error('Agent version drifted');
    const scenarios = (await db.query<{ id: string; stable_key: string; language: string; content_hash: string }>("SELECT id,stable_key,language,content_hash FROM nazir.scenarios WHERE id=ANY($1::uuid[]) AND status='approved' ORDER BY stable_key,language",[input.scenarioIds])).rows;
    if (scenarios.length!==input.scenarioIds.length) throw new Error('Approved scenarios required');
    // A plan that names an order is run in that order; otherwise the stable key order is kept.
    if (input.order) { const rank=(id:string) => { const i=input.order!.indexOf(id); return i<0?input.order!.length:i; }; scenarios.sort((a,b) => rank(a.id)-rank(b.id)); }
    const manifest = { registry_id: version.id, configHash: version.configHash, systemPromptHash: version.systemPromptHash, toolManifestHash: version.toolManifestHash, rulePackHash: rulePackHash(), scenarios: scenarios.map((s) => ({ id:s.id,hash:s.content_hash })), runnerVersion, recordsOnly:input.recordsOnly ?? plan.stop_rules.records_only ?? false, rubricVersion, judgePromptHash, judgeChainOrder:chainOrder(providerRegistry(process.env),'judge','nvidia_nemotron').map((e) => ({provider:e.provider.id,model:e.model,family:e.family})), aiChainOrder: chainOrder(providerRegistry(process.env),'agent').map((e) => ({ provider:e.provider.id,model:e.model })), manifestVersion, ...(input.lessons?.length ? { lessons:input.lessons } : {}), ...(input.repeatsFor ? { repeatsFor:input.repeatsFor } : {}), ...(version.kind==='repair' ? { repair:{ parent_registry_id:row.config.parent_registry_id,patch:row.config.patch,executable_hash:row.config.executable_hash } } : {}) };
    const run = (await db.query<{ id: string }>("INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,status,frozen_manifest,runner_version,calls_budget,idempotency_key) VALUES($1,$2,$3,$4,'queued',$5,$6,$7,$8) RETURNING id",[input.workspaceId,input.planId,input.agentVersionId,plan.rule_pack_version_id,JSON.stringify(manifest),runnerVersion,plan.budget_calls,input.idempotencyKey])).rows[0]!;
    for (const s of scenarios) for (let repeat=1;repeat<=(input.repeatsFor?.[s.id] ?? input.repeats);repeat++) await db.query(input.order?"INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,status,idempotency_key,agent_version_id,scenario_hash,created_at) VALUES($1,$2,$3,$4,'queued',$5,$6,$7,clock_timestamp())":"INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,status,idempotency_key,agent_version_id,scenario_hash) VALUES($1,$2,$3,$4,'queued',$5,$6,$7)",[input.workspaceId,run.id,s.id,s.language,`${s.stable_key}:${s.language}:${repeat}`,input.agentVersionId,s.content_hash]);
    await db.query("SELECT nazir.append_audit('run_enqueued','run',$1,$2)",[run.id,JSON.stringify({ manifest_hash:hash(manifest),scenario_count:scenarios.length,repeats:input.repeats })]);
    return run;
  });
}
