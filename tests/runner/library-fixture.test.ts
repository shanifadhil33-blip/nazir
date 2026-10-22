import { beforeAll,afterAll,expect,it } from 'vitest';
import { testDatabase,type TestDatabase } from '../helpers/pglite';
import { withSandbox } from '../../src/server/db/context';
import { createInspectionChannel } from '../../src/server/inspection/channel';
import { createSandboxTools } from '../../src/sandbox/tools';
import { getAgentVersion } from '../../src/sandbox/versions';
import { createLibraryFixture } from '../../src/server/runner/library-fixture';
import { loadLibrary } from '../../src/server/library/load';
import { approveScenario, importLibrary } from '../../src/server/library/import';
let db:TestDatabase;
beforeAll(async()=>{ db=await testDatabase(); }); afterAll(async()=>{await db?.close();});
const seededCase={requester_key:'saeed',reference:'NZ-070000',category:'complaint',queue:'complaint_review',status:'open',prior_request_ref:'SR-1042'};
const state={seed:'sandbox',cases:[seededCase],tool_failure:'none'};
async function seed(tenant:string,value:unknown=state) {return db.driver.transaction(async sql=>{await sql.query('SET LOCAL ROLE nazir_worker');await sql.query('SELECT sandbox.seed_tenant($1)',[tenant]);await sql.query('SELECT sandbox.seed_tenant_state($1,$2::jsonb)',[tenant,JSON.stringify(value)]);});}
it('seeds cases and never collides with later generated references',async()=> {
 await seed('seed_ok'); const reading=await createInspectionChannel(db.driver).snapshot('seed_ok'); expect(reading.cases[0]).toMatchObject({reference:'NZ-070000',requesterKey:'saeed',status:'open'});
 await withSandbox(db.driver,{tenant:'seed_ok',requesterKey:'saeed'},async sql=>{ const row=(await sql.query<{reference:string}>("INSERT INTO sandbox.cases(tenant,requester_key,category,summary,queue) VALUES('seed_ok','saeed','information','Synthetic','general_information') RETURNING reference")).rows[0]!;expect(Number(row.reference.slice(3))).toBeGreaterThan(70000); });
});
it.each([null,[],{...state,extra:true},{...state,seed:'other'},{...state,cases:{}},{...state,tool_failure:'other'},{...state,cases:Array(11).fill(seededCase)},...['requester_key','reference','category','queue','status','prior_request_ref'].map(k=>({...state,cases:[{...seededCase,[k]:k==='prior_request_ref'?'SR-9999':null}]})),{...state,cases:[{...seededCase,reference:'NZ-12'}]},{...state,cases:[{...seededCase,extra:1}]},{...state,cases:[seededCase,seededCase]}])('refuses invalid state %#',async value=>{ await expect(seed('refuse_'+crypto.randomUUID().slice(0,8),value)).rejects.toThrow(); });
it('accepts empty legacy state and null prior request',async()=> { await seed('empty',{});await seed('null_prior',{...state,cases:[{...seededCase,prior_request_ref:null}]}); });
it('refuses tenants containing a case, receipt or failure setting',async()=> {
 await expect(seed('seed_ok',{})).rejects.toThrow();
 await seed('receipt',{});await db.owner.query("INSERT INTO sandbox.tool_receipts(tenant,tool,request,response,outcome) VALUES('receipt','create_case','{}','{}','error')"); await expect(seed('receipt',{})).rejects.toThrow();
 await seed('fault_existing',{seed:'sandbox',cases:[],tool_failure:'create_case'});await expect(seed('fault_existing',{})).rejects.toThrow();
});
it.each(['nazir_app','nazir_sandbox','nazir_inspector'])('refuses execute as %s',async role=>{ await expect(db.driver.transaction(async sql=>{await sql.query('SET LOCAL ROLE '+role);await sql.query("SELECT sandbox.seed_tenant_state('refused','{}')");})).rejects.toThrow(); });
it('fails a real create tool through its savepoint and records an error receipt',async()=> {
 await seed('failure',{seed:'sandbox',cases:[],tool_failure:'create_case'});
 const result=await createSandboxTools({driver:db.driver,tenant:'failure',requesterKey:'saeed'},getAgentVersion('baseline')!).execute('create_case',{category:'complaint',summary:'Delayed request',requester_name:'Saeed Al Hashimi',prior_request_ref:'SR-1042'},{idempotencyKey:'failure_call'});
 expect(result).toMatchObject({ok:false,error:'tool_failed'});const reading=await createInspectionChannel(db.driver).snapshot('failure');expect(reading.cases).toEqual([]);expect(reading.receipts).toMatchObject([{tool:'create_case',outcome:'error',error:'tool_failed'}]);expect(reading.tenantFaults).toEqual([{tool:'create_case'}]);
});
it('prepares the entire library once without changing rows or audit on replay',async()=> {
 const first=await db.driver.transaction(createLibraryFixture); const before=(await db.owner.query('SELECT count(*) AS n FROM nazir.audit_events')).rows;
 const second=await db.driver.transaction(createLibraryFixture); expect(second).toEqual(first);expect(Object.keys(first.scenarios)).toHaveLength(58);expect((await db.owner.query('SELECT count(*) AS n FROM nazir.audit_events')).rows).toEqual(before);
 expect((await db.owner.query("SELECT DISTINCT status FROM nazir.scenarios WHERE workspace_id=$1 AND library_hash IS NOT NULL",[first.workspaceId])).rows).toEqual([{status:'approved'}]);
 const complaint=(await db.owner.query<{stable_key:string;n:number}>("SELECT stable_key,count(*)::int AS n FROM nazir.scenarios WHERE workspace_id=$1 AND stable_key IN ('complaint_en','complaint_ar') GROUP BY stable_key ORDER BY stable_key",[first.workspaceId])).rows;
 expect(complaint).toEqual([{stable_key:'complaint_ar',n:1},{stable_key:'complaint_en',n:1}]);
});
it('retires the older approved version when a changed library scenario is approved',async()=> {
 const fx=await db.driver.transaction(createLibraryFixture);
 const library=await loadLibrary();const target=library[0]!.meanings[0]!.scenarios[0]!;target.resident_turns=[target.resident_turns[0]+' Thank you.',...target.resident_turns.slice(1)];
 const nested={transaction:async<T>(fn:(sql:never)=>Promise<T>)=>db.driver.transaction(fn as never)};
 const ids=await importLibrary(nested as never,fx.members.author,library);
 const drafts=(await db.owner.query<{id:string}>("SELECT id FROM nazir.scenarios WHERE id=ANY($1::uuid[]) AND status='draft'",[ids])).rows;// The meaning digest covers its scenarios, so both languages of the meaning get a new version.
 expect(drafts).toHaveLength(2);
 for(const d of drafts) await approveScenario(nested as never,fx.members.reviewer,d.id);
 const rows=(await db.owner.query<{version:number;status:string}>("SELECT version,status FROM nazir.scenarios WHERE workspace_id=$1 AND stable_key=$2 ORDER BY version",[fx.workspaceId,target.stable_key])).rows;
 expect(rows).toEqual([{version:1,status:'retired'},{version:2,status:'approved'}]);
});
it.each([
 {...state,seed:1},{...state,tool_failure:null},{seed:'sandbox',cases:[]},
 ...[['requester_key','other'],['category','refund'],['queue',''],['queue',1],['status','closed'],['prior_request_ref',false]].map(([key,value])=>({...state,cases:[{...seededCase,[String(key)]:value}]})),
 {...state,cases:[{requester_key:'saeed'}]},
])('refuses each additional shape violation %#',async value=>{await expect(seed('shape_'+crypto.randomUUID().slice(0,8),value)).rejects.toThrow();});
it('pins function authority and hides service failure settings from sandbox tools',async()=>{
 const row=(await db.owner.query("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='sandbox.seed_tenant_state(text,jsonb)'::regprocedure")).rows[0]!;expect(row.prosecdef).toBe(true);expect(row.proconfig).toEqual(['search_path=pg_catalog, sandbox']);
 for(const role of ['nazir_app','nazir_sandbox'])await expect(db.driver.transaction(async sql=>{await sql.query('SET LOCAL ROLE '+role);await sql.query('SELECT * FROM sandbox.tenant_faults');})).rejects.toThrow();
 await expect(seed('bad tenant',{})).rejects.toThrow();
});
