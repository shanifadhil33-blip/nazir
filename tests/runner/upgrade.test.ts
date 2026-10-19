import { expect,it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp,readFile,writeFile,rm,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { migrate } from '../../src/server/db/migrate';
import type { SqlConnection,TransactionDriver } from '../../src/server/db/driver';
import { createRunnerFixture } from '../../src/server/runner/fixture';
it('upgrades a populated 0010 database without changing legacy evidence',async()=>{
 const pg=new PGlite();const root=await mkdtemp(join(process.cwd(),'tests/runner/.upgrade-'));
 const wrap=(conn:Pick<PGlite,'exec'|'query'>):SqlConnection=>({query:async<T extends Record<string,unknown>>(sql:string,params?:unknown[])=>params?conn.query<T>(sql,params):{rows:(await conn.exec(sql)).at(-1)!.rows as T[]}});
 const driver:TransactionDriver={transaction:fn=>pg.transaction(tx=>fn(wrap(tx)))};
 try {
  for(const name of (await readdir('db/migrations')).filter(n=>n<='0010_library.sql')) await writeFile(join(root,name),await readFile(join('db/migrations',name)));
  expect(await migrate(driver,root)).toHaveLength(10);
  const f=await driver.transaction(sql=>createRunnerFixture(sql,'upgrade'));
  const sql=wrap(pg);const r=(await sql.query<{id:string}>("INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,status,frozen_manifest,runner_version) SELECT workspace_id,id,agent_version_id,rule_pack_version_id,'planned','{}','n10' FROM nazir.plans WHERE id=$1 RETURNING id",[f.planId])).rows[0]!;
  const c=(await sql.query<{id:string}>("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key) VALUES($1,$2,$3,'en','legacy') RETURNING id",[f.workspaceId,r.id,f.scenarios[0]!.id])).rows[0]!;
  await sql.query("INSERT INTO nazir.conversation_messages(workspace_id,conversation_id,seq,speaker,body) VALUES($1,$2,1,'agent','Synthetic historical reply')",[f.workspaceId,c.id]);
  await sql.query("INSERT INTO nazir.state_readings(workspace_id,conversation_id,source,reading) VALUES($1,$2,'inspection_channel','{}')",[f.workspaceId,c.id]);
  await sql.query("INSERT INTO nazir.findings(workspace_id,run_id,conversation_id,scenario_id,check_layer,title,agent_said,really_happened,rule_pack_version_id,rule_clause,agent_version_id,severity,root_cause_class,owner_role,evidence) SELECT $1,$2,$3,$4,'semantic','Historical finding','Historical quote','Historical record',rule_pack_version_id,'3.1',agent_version_id,'high','unknown','quality_reviewer','{}' FROM nazir.plans WHERE id=$5",[f.workspaceId,r.id,c.id,f.scenarios[0]!.id,f.planId]);
  const before=(await sql.query('SELECT to_jsonb(f) AS row FROM nazir.findings f')).rows[0]!.row as Record<string,unknown>;
  expect(await migrate(driver)).toEqual(['0011_fixtures.sql','0012_findings.sql','0013_compare.sql','0014_repair.sql','0015_memory.sql']);
  const after=(await sql.query('SELECT to_jsonb(f) AS row FROM nazir.findings f')).rows[0]!.row as Record<string,unknown>;
  for(const [key,value]of Object.entries(before))expect(JSON.stringify(after[key])).toBe(JSON.stringify(value));expect(after.check_id).toBeNull();
  expect((await sql.query('SELECT * FROM nazir.conversation_messages')).rows).toHaveLength(1);expect((await sql.query('SELECT * FROM nazir.state_readings')).rows).toHaveLength(1);
 } finally {await pg.close();await rm(root,{recursive:true,force:true});}
});
