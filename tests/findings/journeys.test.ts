import { beforeAll,afterAll,expect,it } from 'vitest';
import { testDatabase,type TestDatabase } from '../helpers/pglite';
import { fixture,journey,type Fixture } from '../runner/helpers';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { runNextConversation } from '../../src/server/runner/worker';
import { checkFindingComplete } from '../../src/server/findings/probe';
import { listFindings,findingCard } from '../../src/server/findings/read';
import { readAuditChain,verifyAuditChain } from '../../src/server/audit/verify';
import { semantic } from '../judge/helpers';
import type { SemanticResult } from '../../src/server/judge/judge';
import { createLibraryFixture } from '../../src/server/runner/library-fixture';
import type { ChatModel } from '../../src/sandbox/agent';
import { networkJudge } from '../../src/server/runner/network-judge';
let db:TestDatabase,f:Fixture;
beforeAll(async()=>{db=await testDatabase();f=await fixture(db,'findings');});afterAll(async()=>{await db?.close();});
async function run(version='baseline',language='en',judge:SemanticResult['status']='supported',model:ChatModel=journey()) {
 const run=await enqueueRun(db.driver,{workspaceId:f.workspaceId,planId:f.planId,agentVersionId:f.versions.find(v=>v.registry_id===version)!.id,scenarioIds:f.scenarios.filter(s=>s.language===language).map(s=>s.id),repeats:1,idempotencyKey:crypto.randomUUID(),recordsOnly:false});
 await runNextConversation({driver:db.driver,inspectionDriver:db.driver,workerId:'findings_worker',chatModelFactory:()=>model,judgeFactory:()=>async ({input})=>semantic(judge,input.reply.slice(0,80),judge==='contradicted'?'wrong_policy':'none')});
 const conversation=(await db.owner.query('SELECT * FROM nazir.conversations WHERE run_id=$1',[run.id])).rows[0]!;
 const findings=(await db.owner.query('SELECT * FROM nazir.findings WHERE run_id=$1 ORDER BY check_id',[run.id])).rows;
 return {run,conversation,findings};
}
for(const version of ['baseline','planted_wrong_queue','planted_false_submit']) for(const language of ['en','ar']) it(`${version} ${language} retains records under a supported judge`,async()=> {
 const {conversation,findings}=await run(version,language);
 expect(conversation.status).toBe(version==='baseline'?'passed':'failed');
 const summary=conversation.result_summary as {results:{records:unknown[];semantic:{status:string}}};expect(summary.results.semantic.status).toBe('supported');expect(summary.results.records).toHaveLength(7);
 if(version==='baseline') expect(findings).toEqual([]);
 else {
  expect(findings.map(x=>x.check_id)).toEqual(expect.arrayContaining(version==='planted_wrong_queue'?['right_queue','linked_escalation','reply_matches_record']:['case_exists','reply_matches_record']));
  for(const finding of findings) { expect(checkFindingComplete(finding)).toEqual([]);expect(finding.severity).toBe('critical');expect(finding.agent_said).toBeTruthy();expect(finding.title_ar).toMatch(/[\u0600-\u06ff]/); }
  if(version==='planted_wrong_queue') for(const finding of findings.filter(x=>['right_queue','linked_escalation'].includes(String(x.check_id)))) {expect(finding).toMatchObject({root_cause_class:'workflow_failure',owner_role:'supplier_maintainer'});expect(finding.really_happened).toContain('general_information');expect(finding.really_happened).toContain('NZ-');}
  else for(const finding of findings.filter(x=>['case_exists','reply_matches_record'].includes(String(x.check_id)))) {expect(finding).toMatchObject({root_cause_class:'adapter_failure',owner_role:'supplier_maintainer'});expect(finding.agent_said).toContain(language==='en'?'reference pending':'قيد الانتظار');expect(JSON.stringify(finding.evidence)).toContain('tool_failed');}
 }
});
it('creates one semantic finding quoting the judge span',async()=> {const result=await run('baseline','en','contradicted');expect(result.conversation.status).toBe('failed');expect(result.findings).toHaveLength(1);expect(result.findings[0]).toMatchObject({check_id:'semantic',root_cause_class:'knowledge_or_source'});expect(checkFindingComplete(result.findings[0]!)).toEqual([]);});
it.each(['uncertain','unavailable'] as const)('stores %s without findings or retry',async status=> {const {conversation,findings}=await run('baseline','en',status);expect(conversation).toMatchObject({status:'inconclusive',inconclusive_reason:status==='uncertain'?'judge_uncertain':'judge_unavailable',attempt:1});expect(findings).toEqual([]);expect((conversation.result_summary as {records:unknown[]}).records).toHaveLength(7);});
it('does not replay a completed conversation or duplicate findings',async()=> {const {run:runRow,findings}=await run('planted_wrong_queue');expect(await runNextConversation({driver:db.driver,inspectionDriver:db.driver,workerId:'replay',chatModelFactory:()=>journey()})).toBeNull();expect((await db.owner.query('SELECT * FROM nazir.findings WHERE run_id=$1',[runRow.id])).rows).toHaveLength(findings.length);});
it('keeps finding evidence immutable',async()=> {const {findings}=await run('planted_false_submit');await expect(db.owner.query("UPDATE nazir.findings SET title_ar='تغيير' WHERE id=$1",[findings[0]!.id])).rejects.toThrow('Finding evidence is immutable');});
it('restricts raw reads, filters hidden cases and redacts viewer cards',async()=> {
 const {findings}=await run('planted_wrong_queue');
 const members=await Promise.all(['service_owner','supplier_maintainer','quality_reviewer','viewer'].map(async role=>({role,id:await db.createMember(f.workspaceId,[role as 'viewer'],'Hassan Mansoor')})));
 for(const {id,role} of members) {
  const rows=await listFindings(db.driver,id);expect(rows.length).toBeGreaterThan(0);const row=rows.find(r=>r.id===findings[0]!.id)!;
  const card=await findingCard(db.driver,id,String(row.id));expect(card?.ar.title).toBeTruthy();
  if(role==='viewer') {expect(row.agent_said).toBeUndefined();expect(row.evidence).toBeUndefined();expect(card?.en.said).toBeNull();expect(await db.member(id,async sql=>(await sql.query('SELECT * FROM nazir.findings')).rows)).toEqual([]);}
  else expect(row.evidence).toBeTruthy();
 }
 const lib=await db.driver.transaction(createLibraryFixture);
 const hidden=lib.scenarios.broad_case_export_trap_en!;
 const existing=findings[0]!;
 const fields={...existing,id:crypto.randomUUID(),workspace_id:lib.workspaceId,scenario_id:hidden,check_id:'hidden_check'};
 // Use a run and conversation from the same library workspace to retain composite foreign keys.
 const r=await enqueueRun(db.driver,{workspaceId:lib.workspaceId,planId:lib.planId,agentVersionId:lib.versions[0]!.id,scenarioIds:[hidden],repeats:1,idempotencyKey:crypto.randomUUID(),recordsOnly:true});
 await runNextConversation({driver:db.driver,inspectionDriver:db.driver,workerId:'hidden_worker',chatModelFactory:()=>async()=>({content:'Cannot export other cases.'})});
 const c=(await db.owner.query('SELECT id FROM nazir.conversations WHERE run_id=$1',[r.id])).rows[0]!;
 const rules=(await db.owner.query('SELECT rule_pack_version_id FROM nazir.runs WHERE id=$1',[r.id])).rows[0]!;
 Object.assign(fields,{run_id:r.id,conversation_id:c.id,agent_version_id:lib.versions[0]!.id,rule_pack_version_id:rules.rule_pack_version_id});
 await db.owner.query(`INSERT INTO nazir.findings SELECT (jsonb_populate_record(NULL::nazir.findings,$1::jsonb)).*`,[JSON.stringify(fields)]);
 for(const role of ['supplier_maintainer','viewer','quality_reviewer','service_owner'] as const) {
  const id=await db.createMember(lib.workspaceId,[role],'Yusuf Salim');const rows=await listFindings(db.driver,id);expect(rows.some(row=>row.check_id==='hidden_check')).toBe(['service_owner','quality_reviewer'].includes(role));
  if(role==='supplier_maintainer') expect((await db.member(id,sql=>sql.query("SELECT * FROM nazir.findings WHERE check_id='hidden_check'"))).rows).toEqual([]);
 }
 const outsider=await db.bootstrap('outsider');expect(await listFindings(db.driver,outsider.member_id,{runId:r.id})).toEqual([]);
 await db.owner.query("UPDATE nazir.members SET status='removed' WHERE id=$1",[members[0]!.id]);await expect(listFindings(db.driver,members[0]!.id)).rejects.toThrow();
});
it('reserves a run call for every judge attempt and stops at budget',async()=> {
 const local=await fixture(db,'judge_budget'); await db.owner.query('UPDATE nazir.plans SET budget_calls=8 WHERE id=$1',[local.planId]);
 const r=await enqueueRun(db.driver,{workspaceId:local.workspaceId,planId:local.planId,agentVersionId:local.versions.find(v=>v.registry_id==='baseline')!.id,scenarioIds:[local.scenarios.find(s=>s.language==='en')!.id],repeats:1,idempotencyKey:crypto.randomUUID(),recordsOnly:false});
 let fetches=0;
 await runNextConversation({driver:db.driver,inspectionDriver:db.driver,workerId:'budget_judge',chatModelFactory:context=>{ const model=journey();return async req=>{context.onCall({provider:'scripted',model:'scripted',family:'nvidia_nemotron',attempts:[],failover:false,failoverReason:null});return model(req);};},judgeFactory:context=>networkJudge(db.driver,context,{env:{GEMINI_API_KEY:'fake',REQUESTY_API_KEY:'fake',ZAI_API_KEY:'fake'},fetch:async()=>{fetches++;return Response.json({choices:[{message:{content:'broken json'}}]});}})});
 const runRow=(await db.owner.query('SELECT calls_used FROM nazir.runs WHERE id=$1',[r.id])).rows[0]!;expect(runRow.calls_used).toBe(8);expect(fetches).toBe(1);
 const c=(await db.owner.query('SELECT status,inconclusive_reason,result_summary FROM nazir.conversations WHERE run_id=$1',[r.id])).rows[0]!;expect(c).toMatchObject({status:'inconclusive',inconclusive_reason:'judge_unavailable'});expect((c.result_summary as {records:unknown[]}).records).toHaveLength(7);
});
it('verifies audit links including one event per finding',async()=> { const chain=await readAuditChain(db.owner,f.workspaceId);expect(verifyAuditChain(chain)).toEqual({ok:true,count:chain.length});const findings=(await db.owner.query('SELECT id FROM nazir.findings WHERE workspace_id=$1',[f.workspaceId])).rows;expect(chain.filter(e=>e.action==='finding_opened')).toHaveLength(findings.length); });
it('writes findings only on the final attempt after an infrastructure retry',async()=> {
 const {AiChainExhausted}=await import('../../src/server/ai/chain');
 const local=await fixture(db,'finding_retry');
 const r=await enqueueRun(db.driver,{workspaceId:local.workspaceId,planId:local.planId,agentVersionId:local.versions.find(v=>v.registry_id==='planted_wrong_queue')!.id,scenarioIds:[local.scenarios.find(s=>s.language==='en')!.id],repeats:1,idempotencyKey:crypto.randomUUID(),recordsOnly:false});
 const first=await runNextConversation({driver:db.driver,inspectionDriver:db.driver,workerId:'first_retry',chatModelFactory:()=>async()=>{throw new AiChainExhausted([]);},judgeFactory:()=>async()=>semantic()});expect(first).toMatchObject({status:'queued'});
 expect((await db.owner.query('SELECT * FROM nazir.findings WHERE run_id=$1',[r.id])).rows).toEqual([]);
 await db.owner.query('UPDATE nazir.conversations SET available_at=now() WHERE run_id=$1',[r.id]);
 await runNextConversation({driver:db.driver,inspectionDriver:db.driver,workerId:'last_retry',chatModelFactory:()=>journey(),judgeFactory:()=>async({input})=>semantic('supported',input.reply)});
 const findings=(await db.owner.query('SELECT * FROM nazir.findings WHERE run_id=$1',[r.id])).rows;expect(findings.length).toBeGreaterThan(0);for(const finding of findings){expect(finding.attempt).toBe(2);expect(checkFindingComplete(finding)).toEqual([]);}
});
