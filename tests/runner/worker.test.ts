import { beforeAll,afterAll,beforeEach,afterEach,expect,it,vi } from 'vitest';
import { testDatabase,type TestDatabase } from '../helpers/pglite';
import { fixture,enqueue,claim,journey,httpReply,requestMessages,type Fixture } from './helpers';
import { runNextConversation,type Verdict } from '../../src/server/runner/worker';
import { cancelRun } from '../../src/server/runner/cancel';
import { createInspectionChannel } from '../../src/server/inspection/channel';
import { createSandboxTools,toolManifest } from '../../src/sandbox/tools';
import { baselineVersion } from '../../src/sandbox/versions';
import { createAiChain } from '../../src/server/ai/chain';
import { chainChatModel } from '../../src/server/ai/chat-model';
import { memoryAiStore } from '../../src/server/ai/store';
import { readAuditChain,verifyAuditChain } from '../../src/server/audit/verify';
let db: TestDatabase,f: Fixture;
beforeAll(async () => { db=await testDatabase(); });
beforeEach(async () => { f=await fixture(db,'worker_'+crypto.randomUUID()); });
afterEach(async () => { const runs=(await db.owner.query<{ id: string; workspace_id: string }>("SELECT id,workspace_id FROM nazir.runs WHERE status IN ('planned','queued','running')")).rows; for (const r of runs) await cancelRun(db.driver,r.workspace_id,r.id); });
afterAll(async () => { await db?.close(); });
const passed=(): Verdict => ({ status:'passed',results:{ checks:1 } });
const next=(extra: Partial<Parameters<typeof runNextConversation>[0]>={}) => runNextConversation({ driver:db.driver,inspectionDriver:db.driver,workerId:'worker_test',chatModelFactory:() => journey(),...extra });
async function row(run: string) { return (await db.owner.query('SELECT * FROM nazir.conversations WHERE run_id=$1 ORDER BY created_at,id',[run])).rows[0]!; }
async function status(run: string) { return (await db.owner.query('SELECT status,finished_at FROM nazir.runs WHERE id=$1',[run])).rows[0]!; }
async function due(cid: unknown) { await db.owner.query("UPDATE nazir.conversations SET available_at=now()-interval '1 second' WHERE id=$1",[cid]); }
it.each(['baseline','planted_wrong_queue','planted_false_submit'].flatMap((version) => ['en','ar'].map((language) => ({ version,language }))))('plays $version in $language and persists inspection evidence',async ({ version,language }) => {
  const run=await enqueue(db,f,version,language); await next();
  const c=await row(run.id);
  expect(c).toMatchObject({ status:'inconclusive',inconclusive_reason:'checks_missing',attempt:1 });
  const messages=(await db.owner.query('SELECT * FROM nazir.conversation_messages WHERE conversation_id=$1 ORDER BY seq',[c.id])).rows;
  expect(messages.filter((m) => m.speaker==='resident')).toHaveLength(3);
  expect(messages.map((m) => m.seq)).toEqual(messages.map((_,i) => i+1));
  const tools=(await db.owner.query('SELECT * FROM nazir.tool_events WHERE conversation_id=$1 ORDER BY seq',[c.id])).rows;
  expect(tools.length).toBe(version==='planted_false_submit'?2:4);
  expect(tools.every((t) => /^[0-9a-f]{64}$/.test(t.payload_hash as string) && t.idempotency_key)).toBe(true);
  const stored=(await db.owner.query<{ source: string; reading: Awaited<ReturnType<ReturnType<typeof createInspectionChannel>['snapshot']>>; reading_hash: string }>('SELECT * FROM nazir.state_readings WHERE conversation_id=$1',[c.id])).rows[0]!;
  expect(stored.source).toBe('inspection_channel'); expect(stored.reading_hash).toMatch(/^[0-9a-f]{64}$/);
  const observed=await createInspectionChannel(db.driver).snapshot(c.sandbox_tenant as string);
  expect(stored.reading.cases).toEqual(observed.cases); expect(stored.reading.receipts).toEqual(observed.receipts);
  expect(stored.reading.cases).toHaveLength(version==='planted_false_submit'?0:1);
  if (version!=='planted_false_submit') expect(stored.reading.cases[0]).toMatchObject({ category:'complaint',queue:version==='baseline'?'complaint_review':'general_information',priorRequestRef:language==='en'?'SR-1042':'SR-2077',escalation:{ queue:version==='baseline'?'complaint_review':'general_information' } });
  expect((await status(run.id)).status).toBe('inconclusive');
});
it('accepts a scripted passed verdict and finishes the run',async () => {
  const run=await enqueue(db,f); await next({ evaluate:passed });
  expect((await row(run.id)).status).toBe('passed'); expect(await status(run.id)).toMatchObject({ status:'passed',finished_at:expect.any(Date) });
  expect(await next()).toBeNull();
});
it('provider exhaustion through N09 overrides passed, retries, and then passes on a fresh tenant',async () => {
  const run=await enqueue(db,f); let clock=Date.now();
  const chain=createAiChain({ store:memoryAiStore(() => clock),env:{},now:() => clock,sleep:async (ms) => { clock+=ms; },fetch:async () => new Response('',{ status:503 }) });
  await next({ evaluate:passed,chatModelFactory:(ctx) => chainChatModel(chain,{ task:'test_run',...ctx }) });
  const first=await row(run.id); expect(first).toMatchObject({ status:'queued',last_error:'provider_exhausted',attempt:1 });
  expect(new Date(first.available_at as Date).getTime()-Date.now()).toBeGreaterThan(29000);
  expect(await next()).toBeNull();
  await due(first.id); await next({ evaluate:passed });
  const second=await row(run.id); expect(second).toMatchObject({ status:'passed',attempt:2 }); expect(second.sandbox_tenant).not.toBe(first.sandbox_tenant);
});
it('retry after a case write uses a new tenant and preserves old evidence',async () => {
  const run=await enqueue(db,f);
  await next({ evaluate:() => ({ status:'inconclusive',reason:'timeout',results:{} }) });
  const first=await row(run.id),channel=createInspectionChannel(db.driver);
  const old=await channel.snapshot(first.sandbox_tenant as string); expect(old.cases).toHaveLength(1);
  await due(first.id); await next({ evaluate:passed });
  const second=await row(run.id),fresh=await channel.snapshot(second.sandbox_tenant as string);
  expect(second.attempt).toBe(2); expect(fresh.cases).toHaveLength(1); expect(fresh.cases[0]!.reference).not.toBe(old.cases[0]!.reference);
  expect((await channel.snapshot(first.sandbox_tenant as string)).cases).toEqual(old.cases);
  const evidence=(await db.owner.query('SELECT attempt FROM nazir.state_readings WHERE conversation_id=$1 ORDER BY attempt',[first.id])).rows;
  expect(evidence).toEqual([{ attempt:1 },{ attempt:2 }]);
});
it('slow model hits the deadline and a late tool reply cannot write',async () => {
  const run=await enqueue(db,f); let called=false;
  await next({ conversationTimeoutMs:40,evaluate:passed,chatModelFactory:() => async () => { called=true; await new Promise((r) => setTimeout(r,90)); return { content:null,tool_calls:[{ id:'late',name:'create_case',arguments:JSON.stringify({ category:'complaint',summary:'Delay',prior_request_ref:'SR-1042',requester_name:'Saeed' }) }] }; } });
  const c=await row(run.id); expect(c).toMatchObject({ status:'queued',last_error:'timeout' }); expect(called).toBe(true);
  await new Promise((r) => setTimeout(r,100));
  expect((await createInspectionChannel(db.driver).snapshot(c.sandbox_tenant as string)).cases).toHaveLength(0);
});
it('budget stops before another model call and is never retried',async () => {
  await db.owner.query('UPDATE nazir.plans SET budget_calls=1 WHERE id=$1',[f.planId]);
  const run=await enqueue(db,f); let calls=0;
  await next({ evaluate:passed,chatModelFactory:() => async () => { calls++; return { content:'Please confirm' }; } });
  expect(calls).toBe(1); expect(await row(run.id)).toMatchObject({ status:'inconclusive',inconclusive_reason:'budget_reached' });
  expect((await db.owner.query('SELECT calls_used FROM nazir.runs WHERE id=$1',[run.id])).rows[0]!.calls_used).toBe(1);
  expect(await next()).toBeNull();
});
it('failed verdict is final and never retried',async () => {
  const run=await enqueue(db,f); await next({ evaluate:() => ({ status:'failed',reason:'wrong_queue',results:{} }) });
  expect(await row(run.id)).toMatchObject({ status:'failed',attempt:1 }); expect((await status(run.id)).status).toBe('failed'); expect(await next()).toBeNull();
});
it('a worker whose lease was reclaimed cannot write evidence or results',async () => {
  const run=await enqueue(db,f); let replacement: Awaited<ReturnType<typeof claim>>;
  const result=await next({ evaluate:passed,chatModelFactory:(ctx) => async () => {
    await db.owner.query("UPDATE nazir.conversations SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[ctx.conversationId]);
    replacement=await claim(db,'new_worker');
    return { content:null,tool_calls:[{ id:'stale',name:'get_service_policy',arguments:'{}' }] };
  } });
  expect(result).toMatchObject({ lost:true }); expect(replacement!.attempt).toBe(2);
  const c=await row(run.id); expect(c).toMatchObject({ status:'running',attempt:2,lease_owner:'new_worker' });
  for (const table of ['conversation_messages','tool_events','state_readings']) expect((await db.owner.query(`SELECT * FROM nazir.${table} WHERE conversation_id=$1`,[c.id])).rows).toHaveLength(0);
});
it('cancel during the evaluator prevents a late passed write',async () => {
  const run=await enqueue(db,f);
  const result=await next({ evaluate:async () => { await cancelRun(db.driver,f.workspaceId,run.id); return passed(); } });
  expect(result).toMatchObject({ lost:true }); expect((await row(run.id)).status).toBe('cancelled'); expect((await status(run.id)).status).toBe('cancelled');
  expect(await next()).toBeNull();
});
it.each(['passed','failed','inconclusive','cancelled'])('aggregates a mixed run with %s',async (outcome) => {
  const run=await enqueue(db,f,'baseline','en',2);
  await next({ evaluate:passed });
  expect((await status(run.id)).status).toBe('running');
  if (outcome==='cancelled') await cancelRun(db.driver,f.workspaceId,run.id);
  else await next({ evaluate:() => ({ status:outcome as Verdict['status'],reason:'checks_missing',results:{} }) });
  expect((await status(run.id)).status).toBe(outcome);
  if (outcome==='inconclusive') expect((await db.owner.query('SELECT inconclusive_reason FROM nazir.runs WHERE id=$1',[run.id])).rows[0]!.inconclusive_reason).toBe('conversations_1');
});
it('records every answered call, answering provider and failover with real N09 fake fetch',async () => {
  const run=await enqueue(db,f); let clock=Date.now(),calls=0;
  const model=journey();
  const chain=createAiChain({ store:memoryAiStore(() => clock),env:{ REQUESTY_API_KEY:'fictional-key' },now:() => clock,sleep:async (ms) => { clock+=ms; },fetch:async (_url,init) => {
    if (++calls%2===1) return new Response('',{ status:503 });
    const response=await model({ messages:requestMessages(init),tools:toolManifest });
    return Response.json({ choices:[{ message:httpReply(response) }] });
  } });
  await next({ evaluate:passed,chatModelFactory:(ctx) => chainChatModel(chain,{ task:'test_run',...ctx }) });
  const c=await row(run.id); expect(c).toMatchObject({ status:'passed',model_provider:'kilo',failover:true });
  expect((c.result_summary as { calls: unknown[] }).calls).toHaveLength(7);
});
it('audit chain verifies and contains runner codes without transcript text',async () => {
  const run=await enqueue(db,f); await next({ evaluate:passed });
  const rows=await db.worker(f.workspaceId,(sql) => readAuditChain(sql,f.workspaceId));
  expect(verifyAuditChain(rows)).toEqual({ ok:true,count:rows.length });
  expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['run_enqueued','run_started','conversation_claimed','conversation_finished','run_finished']));
  expect(rows.map((r) => r.payload).join('')).not.toMatch(/Saeed|SR-1042|complaint about|sent for review/);
  expect((await row(run.id)).status).toBe('passed');
});
it('dirty tenant is refused before any model call',async () => {
  const run=await enqueue(db,f); const c=await row(run.id),tenant='r_'+(c.id as string).replaceAll('-','')+'_1';
  await db.worker(f.workspaceId,(sql) => sql.query('SELECT sandbox.seed_tenant($1)',[tenant]));
  await createSandboxTools({ driver:db.driver,tenant,requesterKey:'saeed' },baselineVersion).execute('get_service_policy',{},{ idempotencyKey:'dirty_check' });
  let called=false;
  await next({ evaluate:passed,chatModelFactory:() => async () => { called=true; return { content:'Hello' }; } });
  expect(called).toBe(false); expect(await row(run.id)).toMatchObject({ status:'queued',last_error:'dirty_tenant' });
});
it('inspection failure overrides passed and retries',async () => {
  const run=await enqueue(db,f);
  await next({ evaluate:passed,inspectionDriver:{ transaction:async () => { throw new Error('Unavailable'); } } });
  expect(await row(run.id)).toMatchObject({ status:'queued',last_error:'reading_failed' });
});
it.each(['running','queued','unknown'])('invalid evaluator status %s cannot pass',async (bad) => {
  const run=await enqueue(db,f); await next({ evaluate:() => ({ status:bad,results:{} } as unknown as Verdict) });
  expect(await row(run.id)).toMatchObject({ status:'inconclusive',inconclusive_reason:'bad_evaluator' });
});
it('infrastructure retry stops at max attempts and cannot later pass',async () => {
  const run=await enqueue(db,f); await db.owner.query('UPDATE nazir.conversations SET max_attempts=1 WHERE run_id=$1',[run.id]);
  await next({ evaluate:() => ({ status:'inconclusive',reason:'timeout',results:{} }) });
  expect(await row(run.id)).toMatchObject({ status:'inconclusive',inconclusive_reason:'timeout',attempt:1 }); expect(await next({ evaluate:passed })).toBeNull();
});
it('fixture creation is idempotent',async () => {
  const other=await fixture(db,'same_fixture'); expect(await fixture(db,'same_fixture')).toEqual(other);
});
it('network accounting counts failed failover calls and stops at the run budget',async () => {
  const { networkChatModel }=await import('../../src/server/runner/network-model');
  await db.owner.query('UPDATE nazir.plans SET budget_calls=2 WHERE id=$1',[f.planId]);
  const run=await enqueue(db,f); let calls=0;
  await next({ evaluate:passed,chatModelFactory:(ctx) => networkChatModel(db.driver,ctx,{ store:memoryAiStore(),env:{},fetch:async () => { calls++; return new Response('',{ status:503 }); } }) });
  expect(calls).toBe(2); expect(await row(run.id)).toMatchObject({ status:'inconclusive',inconclusive_reason:'budget_reached' });
  expect((await db.owner.query('SELECT calls_used FROM nazir.runs WHERE id=$1',[run.id])).rows[0]!.calls_used).toBe(2);
});
it('repeated tool invocations keep action keys and distinct evidence keys',async () => {
  const run=await enqueue(db,f); const base=journey(); let repeated=false;
  await next({ chatModelFactory:() => async (request) => {
    const response=await base(request);
    if (!repeated && response.tool_calls?.[0]?.name==='get_case_status') {
      repeated=true;
      response.tool_calls.push({ ...response.tool_calls[0],id:'repeated_status' });
    }
    return response;
  } });
  const c=await row(run.id),events=(await db.owner.query('SELECT idempotency_key,tool_idempotency_key FROM nazir.tool_events WHERE conversation_id=$1 AND tool_name=\'get_case_status\' ORDER BY seq',[c.id])).rows;
  expect(events).toHaveLength(2); expect(events[0]!.tool_idempotency_key).toBe(events[1]!.tool_idempotency_key); expect(events[0]!.idempotency_key).not.toBe(events[1]!.idempotency_key);
});
it('a hanging evaluator also hits the total deadline',async () => {
  const run=await enqueue(db,f);
  await next({ conversationTimeoutMs:100,evaluate:() => new Promise(() => {}) });
  expect(await row(run.id)).toMatchObject({ status:'queued',last_error:'timeout' });
});
it.each([true,false])('periodic heartbeat keeps or loses the lease, accepted=%s',async (accepted) => {
  const run=await enqueue(db,f);
  let release!: () => void,started!: () => void,observed!: () => void;
  const ready=new Promise<void>((r) => { started=r; }),blocked=new Promise<void>((r) => { release=r; }),heartbeat=new Promise<void>((r) => { observed=r; });
  const driver: typeof db.driver={ transaction:(fn) => db.driver.transaction((sql) => fn({ query:async (query,params) => {
    if (query.includes('nazir.runner_heartbeat')) {
      const result=await sql.query(query,params);
      observed();
      return (accepted?result:{ rows:[{ ok:false }] }) as Awaited<ReturnType<typeof sql.query>>;
    }
    return sql.query(query,params);
  } } as typeof sql)) };
  let first=true; const model=journey();
  vi.useFakeTimers({ toFake:['setInterval','clearInterval'] });
  try {
    const running=next({ driver,leaseSeconds:10,evaluate:passed,chatModelFactory:() => async (request) => { if (first) { first=false; started(); await blocked; } return model(request); } });
    await ready; await vi.advanceTimersByTimeAsync(3340); await heartbeat; release();
    const result=await running;
    if (accepted) expect(await row(run.id)).toMatchObject({ status:'passed' });
    else {
      expect(result).toMatchObject({ lost:true });
      const c=await row(run.id); expect(c.status).toBe('running');
      expect((await db.owner.query('SELECT * FROM nazir.conversation_messages WHERE conversation_id=$1',[c.id])).rows).toHaveLength(0);
    }
  } finally { release(); vi.useRealTimers(); }
});
