import { beforeAll,afterAll,expect,it } from 'vitest';
import { testDatabase,type TestDatabase } from '../helpers/pglite';
import { fixture,type Fixture } from './helpers';
let db: TestDatabase,f: Fixture;
beforeAll(async () => { db=await testDatabase(); f=await fixture(db,'state'); });
afterAll(async () => { await db?.close(); });
const states=['planned','queued','running','passed','failed','inconclusive','cancelled'];
const transitions: Record<string,string[]>={ planned:['queued','cancelled'],queued:['running','cancelled'],running:['queued','passed','failed','inconclusive','cancelled'] };
const matrix=['runs','conversations'].flatMap((table) => ['owner','worker'].flatMap((role) => states.flatMap((from) => states.map((to) => ({ table,role,from,to })))));
it.each(matrix)('$table $role $from to $to',async ({ table,role,from,to }) => {
  const run=(await db.owner.query<{ id: string }>("INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,inconclusive_reason) SELECT workspace_id,id,agent_version_id,rule_pack_version_id,'{}','state',$2,'test_reason' FROM nazir.plans WHERE id=$1 RETURNING id",[f.planId,table==='runs'?from:'planned'])).rows[0]!;
  let id=run.id;
  if (table==='conversations') id=(await db.owner.query<{ id: string }>('INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status,inconclusive_reason) VALUES($1,$2,$3,\'en\',$4,$5,\'test_reason\') RETURNING id',[f.workspaceId,run.id,f.scenarios[0]!.id,crypto.randomUUID(),from])).rows[0]!.id;
  const write=() => role==='owner'?db.owner.query(`UPDATE nazir.${table} SET status=$2 WHERE id=$1`,[id,to]):db.worker(f.workspaceId,(sql) => sql.query(`UPDATE nazir.${table} SET status=$2 WHERE id=$1`,[id,to]));
  if (from===to || transitions[from]?.includes(to)) await expect(write()).resolves.toBeDefined(); else await expect(write()).rejects.toThrow(/State transition refused|Final record is immutable/);
});
it.each(['runs','conversations'])('%s requires a reason on insert and freezes final fields',async (table) => {
  const run=(await db.owner.query<{ id: string }>("INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,inconclusive_reason) SELECT workspace_id,id,agent_version_id,rule_pack_version_id,'{}','state','inconclusive','checks_missing' FROM nazir.plans WHERE id=$1 RETURNING id",[f.planId])).rows[0]!;
  let id=run.id;
  if (table==='conversations') id=(await db.owner.query<{ id: string }>("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status,inconclusive_reason) VALUES($1,$2,$3,'en',$4,'inconclusive','checks_missing') RETURNING id",[f.workspaceId,run.id,f.scenarios[0]!.id,crypto.randomUUID()])).rows[0]!.id;
  for (const role of ['owner','worker']) {
    const update=(set: string) => role==='owner'?db.owner.query(`UPDATE nazir.${table} SET ${set} WHERE id=$1`,[id]):db.worker(f.workspaceId,(sql) => sql.query(`UPDATE nazir.${table} SET ${set} WHERE id=$1`,[id]));
    await expect(update("inconclusive_reason='changed'")).rejects.toThrow();
    await expect(update("inconclusive_reason=' '")).rejects.toThrow('Reason required');
    await expect(update("finished_at=now()")).rejects.toThrow();
  }
});
it.each(['runs','conversations'].flatMap((table) => ['owner','worker'].map((role) => ({ table,role }))))('$table $role refuses blank reasons on insert',async ({ table,role }) => {
  const run=(await db.owner.query<{ id: string }>("INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version) SELECT workspace_id,id,agent_version_id,rule_pack_version_id,'{}','state' FROM nazir.plans WHERE id=$1 RETURNING id",[f.planId])).rows[0]!;
  for (const reason of [null,'','   ']) {
    const sql=table==='runs'?"INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,inconclusive_reason) SELECT workspace_id,id,agent_version_id,rule_pack_version_id,'{}','state','inconclusive',$2 FROM nazir.plans WHERE id=$1":"INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status,inconclusive_reason) VALUES($3,$1,$4,'en','bad_reason','inconclusive',$2)";
    const params=table==='runs'?[f.planId,reason]:[run.id,reason,f.workspaceId,f.scenarios[0]!.id];
    await expect(role==='owner'?db.owner.query(sql,params):db.worker(f.workspaceId,(c) => c.query(sql,params))).rejects.toThrow('Reason required');
  }
});
it.each(['passed','failed','inconclusive','cancelled'])('all result fields freeze after %s for both roles',async (status) => {
  const run=(await db.owner.query<{ id: string }>("INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,inconclusive_reason) SELECT workspace_id,id,agent_version_id,rule_pack_version_id,'{}','state',$2,'checks_missing' FROM nazir.plans WHERE id=$1 RETURNING id",[f.planId,status])).rows[0]!;
  const c=(await db.owner.query<{ id: string }>("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status,inconclusive_reason,result_summary) VALUES($1,$2,$3,'en',$4,$5,'checks_missing','{}') RETURNING id",[f.workspaceId,run.id,f.scenarios[0]!.id,crypto.randomUUID(),status])).rows[0]!;
  for (const role of ['owner','worker']) for (const [table,id,set] of [['runs',run.id,'calls_used=9'],['conversations',c.id,"result_summary='{\"changed\":true}'"],['conversations',c.id,"model_provider='changed'"],['conversations',c.id,"failover=true"]]) {
    const sql=`UPDATE nazir.${table} SET ${set} WHERE id=$1`;
    await expect(role==='owner'?db.owner.query(sql,[id]):db.worker(f.workspaceId,(conn) => conn.query(sql,[id]))).rejects.toThrow('Final record is immutable');
  }
});
