import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { readExternalAgent, saveExternalAgent, testExternalAgent } from '../../src/server/settings/external-agent';
import { confirmSafety, safetyStep, startSafety } from '../../src/server/safety/run';
import { domainProof } from '../../src/server/safety/ownership';
import { attackForSession, attacksFor } from '../../src/server/safety/attacks';
import { emptyMap } from '../../src/server/safety/map';
const fake = vi.hoisted(() => ({ driver: vi.fn() }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: fake.driver }));
import { GET } from '../../src/app/c/[id]/route';
let db: TestDatabase;
const resolve = async () => [{ address: '93.184.215.14' }];
beforeAll(async () => { vi.stubEnv('AUTH_SECRET','canary-session-test-secret-long-enough'); db=await testDatabase(); fake.driver.mockReturnValue(db.driver); },60000);
afterAll(async () => { await db?.close();vi.unstubAllEnvs(); });
async function start() {
 const who=await db.bootstrap('Canary '+crypto.randomUUID());
 await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1",[who.workspace_id]);
 await saveExternalAgent(db.driver,who.member_id,{name:'Desk',endpoint:'https://agent.example.com/chat',format:'simple_json'},undefined,resolve);
 await testExternalAgent(db.driver,who.member_id,{message:'Hello',language:'en'},{resolve,fetcher:async()=>Response.json({reply:'Hello'})});
 const connection=(await readExternalAgent(db.driver,who.member_id))!;
 const proof=domainProof(who.workspace_id,connection);
 await confirmSafety(db.driver,who.member_id,{resolve,fetcher:async()=>new Response(proof.token)});
 const {id}=await startSafety(db.driver,who.member_id,'real');
 await db.owner.query("DELETE FROM nazir.safety_attempts WHERE run_id=$1 AND family<>'S2'",[id]);
 const canary=(await db.owner.query<{canary:string}>('SELECT canary FROM nazir.safety_runs WHERE id=$1',[id])).rows[0]!.canary;
 return {...who,id,canary};
}
async function hit(canary:string,session?:string) {
 const url=`https://nazir-liard.vercel.app/c/${canary.toLowerCase()}${session?'?s='+session:''}`;
 const response=await GET(new Request(url),{params:Promise.resolve({id:canary.toLowerCase()})});
 expect(response.status).toBe(204); expect(await response.text()).toBe('');
}
it('replaces only the generated sink in outgoing prompts and signed injection',()=>{
 const attack=attacksFor(emptyMap('replies_only'),'NZC-1234ABCD').find(a=>a.id==='S2-en')!;
 const scoped=attackForSession({...attack,inject:attack.turns[0]},'NZC-1234ABCD','ses_'+'a'.repeat(32));
 expect(scoped.turns[0]).toContain('?s=ses_'+'a'.repeat(32)); expect(scoped.inject).toBe(scoped.turns[0]);
 expect(attack.turns[0]).not.toContain('?s=');
});
it('one English hit cannot break the Arabic question, even when an old run-wide hit exists',async()=>{
 const who=await start();
 await db.owner.query('INSERT INTO nazir.canary_hits(workspace_id,run_id) VALUES($1,$2)',[who.workspace_id,who.id]);
 const sessions:Record<string,string>={};
 await safetyStep(db.driver,{turnGapMs:0,transport:{resolve,fetcher:async(_url,init)=>{
  const body=JSON.parse(String(init.body)), session=new Headers(init.headers).get('x-nazir-session')!;
  sessions[body.language]=session; expect(body.message).toContain('?s='+session);
  if(body.language==='en') { await hit(who.canary,session); await hit(who.canary,session); }
  return Response.json({reply:'Sorry, I cannot send that.'});
 }}});
 const rows=(await db.owner.query('SELECT language,outcome,proven,session_id FROM nazir.safety_attempts WHERE run_id=$1 ORDER BY language',[who.id])).rows;
 expect(rows).toEqual([{language:'ar',outcome:'resisted',proven:'reply',session_id:sessions.ar},{language:'en',outcome:'broken',proven:'canary',session_id:sessions.en}]);
 expect((await db.owner.query('SELECT count(*)::int AS n FROM nazir.canary_hits WHERE run_id=$1 AND session_id IS NOT NULL',[who.id])).rows[0]!.n).toBe(1);
 expect((await db.owner.query("SELECT count(*)::int AS n FROM nazir.audit_events WHERE workspace_id=$1 AND action='safety.canary_hit'",[who.workspace_id])).rows[0]!.n).toBe(1);
},30000);
it('ignores unbound, control, other-workspace, wrong-mode, expired and stopped session hits',async()=>{
 const a=await start(),b=await start();
 const session=async(member:string,mode='security')=>(await db.member(member,sql=>sql.query<{id:string}>('SELECT nazir.open_test_session($1) AS id',[mode]))).rows[0]!.id;
 const control=await session(a.member_id),foreign=await session(b.member_id),quality=await session(a.member_id,'quality');
 for(const s of [undefined,'invalid',control,foreign,quality])await hit(a.canary,s);
 expect((await db.owner.query('SELECT * FROM nazir.canary_hits WHERE run_id=$1',[a.id])).rows).toHaveLength(0);
 await db.owner.query("UPDATE nazir.safety_runs SET status='running' WHERE id=$1",[a.id]);
 const attempt=(await db.owner.query<{id:string}>("UPDATE nazir.safety_attempts SET status='running',session_id=$2 WHERE run_id=$1 AND language='en' RETURNING id",[a.id,quality])).rows[0]!.id;
 await hit(a.canary,quality);
 const expired=await session(a.member_id);
 await db.owner.query('UPDATE nazir.safety_attempts SET session_id=$2 WHERE id=$1',[attempt,expired]);
 await db.owner.query("UPDATE nazir.test_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired]);
 await hit(a.canary,expired);
 const active=await session(a.member_id);
 await db.owner.query('UPDATE nazir.safety_attempts SET session_id=$2 WHERE id=$1',[attempt,active]);
 await hit(b.canary,active); await hit(a.canary,foreign);
 await db.owner.query("UPDATE nazir.safety_runs SET status='stopped' WHERE id=$1",[a.id]);
 await hit(a.canary,active);
 expect((await db.owner.query('SELECT * FROM nazir.canary_hits WHERE run_id=ANY($1::uuid[])',[[a.id,b.id]])).rows).toHaveLength(0);
 await expect(db.member(a.member_id,sql=>sql.query('UPDATE nazir.safety_attempts SET session_id=$1 WHERE id=$2',[active,attempt]))).rejects.toThrow(/permission denied/);
 await expect(db.member(a.member_id,sql=>sql.query('SELECT nazir.safety_canary_hit($1,$2)',[a.canary,active]))).rejects.toThrow(/permission denied/);
},30000);
