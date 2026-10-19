import { beforeAll,afterAll,afterEach,expect,it } from 'vitest';
import { testDatabase,type TestDatabase } from '../helpers/pglite';
import { fixture,enqueue,claim,type Fixture } from './helpers';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { hash } from '../../src/sandbox/demo-rule-pack';
import { cancelRun } from '../../src/server/runner/cancel';
let db: TestDatabase,f: Fixture;
beforeAll(async () => { db=await testDatabase(); f=await fixture(db,'queue'); });
afterAll(async () => { await db?.close(); });
afterEach(async () => { const runs=(await db.owner.query<{ id: string; workspace_id: string }>("SELECT id,workspace_id FROM nazir.runs WHERE status IN ('planned','queued','running')")).rows; for (const r of runs) await cancelRun(db.driver,r.workspace_id,r.id); });
const input=() => ({ workspaceId:f.workspaceId,planId:f.planId,agentVersionId:f.versions[0]!.id,scenarioIds:f.scenarios.map((s) => s.id),repeats:2,idempotencyKey:crypto.randomUUID() });
it('enqueues once per workspace key with frozen canonical manifest and stable conversation keys',async () => {
  const i=input(); const a=await enqueueRun(db.driver,i),b=await enqueueRun(db.driver,i);
  expect(a).toEqual(b);
  const rows=(await db.owner.query('SELECT * FROM nazir.conversations WHERE run_id=$1',[a.id])).rows;
  expect(rows).toHaveLength(4); expect(new Set(rows.map((r) => r.idempotency_key)).size).toBe(4);
  const run=(await db.owner.query<{ frozen_manifest: unknown; manifest_hash: string; calls_budget: number }>('SELECT * FROM nazir.runs WHERE id=$1',[a.id])).rows[0]!;
  expect(run.manifest_hash).toBe(hash(run.frozen_manifest)); expect(run.calls_budget).toBe(60);
  expect((await db.owner.query("SELECT * FROM nazir.audit_events WHERE action='run_enqueued' AND target_id=$1",[a.id])).rows).toHaveLength(1);
});
it.each(['plan','scenario','workspace','drift'])('refuses invalid %s',async (kind) => {
  const other=await fixture(db,'refuse_'+kind),i={ ...input(),workspaceId:other.workspaceId,planId:other.planId,agentVersionId:other.versions[0]!.id,scenarioIds:other.scenarios.map((s) => s.id) };
  if (kind==='plan') await db.owner.query("UPDATE nazir.plans SET status='proposed' WHERE id=$1",[i.planId]);
  if (kind==='scenario') { await db.owner.query("UPDATE nazir.scenarios SET status='retired' WHERE id=$1",[i.scenarioIds[0]]); }
  if (kind==='workspace') i.planId=f.planId;
  if (kind==='drift') { const agent=(await db.owner.query<{ id: string }>("INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config) SELECT workspace_id,agent_id,'Drifted','baseline','{\"registry_id\":\"baseline\",\"changed\":true}' FROM nazir.agent_versions WHERE id=$1 RETURNING id",[i.agentVersionId])).rows[0]!; i.agentVersionId=agent.id; }
  await expect(enqueueRun(db.driver,i)).rejects.toThrow();
  expect((await db.owner.query('SELECT * FROM nazir.runs WHERE workspace_id=$1',[other.workspaceId])).rows).toHaveLength(0);
});
it('claims oldest first, skips live leases, reclaims expired leases on a fresh tenant',async () => {
  const a=await enqueue(db,f),b=await enqueue(db,f);
  await db.owner.query("UPDATE nazir.conversations SET created_at=now()-interval '1 day' WHERE run_id=$1",[a.id]);
  const c=await claim(db); expect(c!.run_id).toBe(a.id); expect(c!.attempt).toBe(1);
  const old=(await db.owner.query('SELECT sandbox_tenant FROM nazir.conversations WHERE id=$1',[c!.conversation_id])).rows[0]!.sandbox_tenant;
  expect((await claim(db,'second'))!.run_id).toBe(b.id);
  expect(await claim(db)).toBeUndefined();
  await db.owner.query("UPDATE nazir.conversations SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[c!.conversation_id]);
  const recovered=await claim(db,'recovery'); expect(recovered!.attempt).toBe(2); expect(recovered!.conversation_id).toBe(c!.conversation_id);
  const tenant=(await db.owner.query('SELECT sandbox_tenant FROM nazir.conversations WHERE id=$1',[c!.conversation_id])).rows[0]!.sandbox_tenant;
  expect(tenant).not.toBe(old); expect(tenant).toMatch(/^[a-z0-9_]{1,64}$/);
  expect((await db.owner.query("SELECT * FROM nazir.audit_events WHERE action='lease_recovered' AND target_id=$1",[c!.conversation_id])).rows).toHaveLength(1);
});
it('exhausted leases finish inconclusive, aggregate, and continue searching',async () => {
  const a=await enqueue(db,f); const c=await claim(db);
  await db.owner.query("UPDATE nazir.conversations SET max_attempts=1,lease_expires_at=now()-interval '1 second' WHERE id=$1",[c!.conversation_id]);
  const b=await enqueue(db,f); expect((await claim(db))!.run_id).toBe(b.id);
  const row=(await db.owner.query('SELECT status,inconclusive_reason FROM nazir.conversations WHERE run_id=$1',[a.id])).rows[0];
  expect(row).toEqual({ status:'inconclusive',inconclusive_reason:'lease_expired' });
  expect((await db.owner.query('SELECT status FROM nazir.runs WHERE id=$1',[a.id])).rows[0]!.status).toBe('inconclusive');
});
it('heartbeats require a live matching worker and attempt',async () => {
  await enqueue(db,f); const c=await claim(db);
  for (const [worker,attempt,expected] of [['other',1,false],['test_worker',2,false],['test_worker',1,true]] as const) {
    const ok=await db.worker(f.workspaceId,async (sql) => (await sql.query<{ ok: boolean }>('SELECT nazir.runner_heartbeat($1,$2,$3,60) AS ok',[c!.conversation_id,worker,attempt])).rows[0]!.ok);
    expect(ok).toBe(expected);
  }
});
it.each(['nazir_app','nazir_sandbox','nazir_inspector'])('%s has no queue execute rights',async (role) => {
  for (const sql of ["SELECT nazir.runner_claim('worker',60)","SELECT nazir.runner_heartbeat(gen_random_uuid(),'worker',1,60)"]) await expect(db.driver.transaction(async (conn) => { await conn.query(`SET LOCAL ROLE ${role}`); return conn.query(sql); })).rejects.toThrow();
});
it.each([['bad worker',60],['worker',9],['worker',901],['',60]])('refuses invalid claim %s %s',async (worker,lease) => {
  await expect(db.driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_worker'); return sql.query('SELECT nazir.runner_claim($1,$2)',[worker,lease]); })).rejects.toThrow();
});
it('retains workspace isolation for runner writes and keys',async () => {
  const other=await fixture(db,'separate'); const i=input(); const a=await enqueueRun(db.driver,i);
  const b=await enqueueRun(db.driver,{ ...i,workspaceId:other.workspaceId,planId:other.planId,agentVersionId:other.versions[0]!.id,scenarioIds:other.scenarios.map((s) => s.id) });
  expect(a.id).not.toBe(b.id);
  for (const table of ['runs','conversations']) expect((await db.worker(f.workspaceId,(sql) => sql.query(`SELECT * FROM nazir.${table} WHERE workspace_id=$1`,[other.workspaceId]))).rows).toHaveLength(0);
  await expect(db.worker(f.workspaceId,(sql) => sql.query('UPDATE nazir.conversations SET workspace_id=$1 WHERE run_id=$2',[other.workspaceId,a.id]))).rejects.toThrow();
});
it('registry references retain version kind and cannot disguise a planted fault',async () => {
  await expect(db.owner.query("INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config) SELECT workspace_id,agent_id,'Disguised','baseline','{\"registry_id\":\"planted_wrong_queue\"}' FROM nazir.agent_versions WHERE id=$1",[f.versions[0]!.id])).rejects.toThrow('Registry kind mismatch');
});
