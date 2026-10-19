import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { runServiceAgent, type Message } from '../../src/sandbox/agent';
import { baselineVersion } from '../../src/sandbox/versions';
import { toolManifest } from '../../src/sandbox/tools';
import { chainChatModel } from '../../src/server/ai/chat-model';
import { createAiChain, type CallMeta } from '../../src/server/ai/chain';
import { postgresAiStore } from '../../src/server/ai/store';
let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); }); afterAll(async () => { await db?.close(); });
const wid = '00000000-0000-0000-0000-000000000000';
function call(name: string, args: unknown) { return { content:null,tool_calls:[{ id:crypto.randomUUID(),type:'function',function:{ name,arguments:JSON.stringify(args) } }] }; }
it.each([false,true])('runs a full service journey through fake HTTP, Arabic=%s', async (ar) => {
  const tenant = ar ? 'chain_arabic' : 'chain_english';
  await db.worker(wid,(conn) => conn.query('SELECT sandbox.seed_tenant($1)',[tenant]));
  const meta: CallMeta[] = [];
  let clock = Date.now(); const now = () => clock;
  const fetch: typeof globalThis.fetch = async (_url,init) => {
    const body = JSON.parse(init!.body as string);
    expect(body.tools).toEqual(toolManifest);
    expect(body.messages[0].role).toBe('system');
    const user = body.messages.filter((m: Message) => m.role === 'user').at(-1).content;
    const results = body.messages.filter((m: Message) => m.role === 'tool').map((m: Message) => JSON.parse(m.content!));
    let reply;
    if (!user.includes(ar ? 'أؤكد' : 'confirm')) reply = { content: user.includes('SR-1042') ? (ar ? 'هل تؤكد إنشاء الحالة؟' : 'Do you confirm creating this case?') : (ar ? 'اذكر الاسم ورقم الطلب ووصف المشكلة.' : 'Please give your name, earlier reference and description.') };
    else if (!results.length) reply = call('get_service_policy',{});
    else if (results.length === 1) reply = call('create_case',{ category:'complaint',summary:ar ? 'تأخر تجديد التصريح' : 'Delayed permit renewal',prior_request_ref:'SR-1042',requester_name:ar ? 'سعيد الهاشمي' : 'Saeed Al Hashimi' });
    else if (results.length === 2) reply = call('get_case_status',{ reference:results[1].data.reference });
    else if (results.length === 3) reply = call('request_human_review',{ reference:results[1].data.reference,reason:ar ? 'أطلب مراجعة بشرية' : 'Please review' });
    else reply = { content:ar ? `أرسلت الحالة ${results[1].data.reference} للمراجعة` : `Case ${results[1].data.reference} sent for review.` };
    return Response.json({ choices:[{ message:reply }] });
  };
  const chain = createAiChain({ fetch,store:postgresAiStore(db.driver),env:{ REQUESTY_API_KEY:'test-key' },now,sleep:async (ms) => { clock += ms; } });
  const conversationId = crypto.randomUUID();
  const model = chainChatModel(chain,{ task:'test_run',conversationId,workspaceId:wid,onCall:(m) => meta.push(m) });
  let messages: Message[] = [];
  let final;
  for (const content of ar ? ['أريد تقديم شكوى ومراجعة بشرية.','سعيد الهاشمي، SR-1042، تأخر تجديد التصريح.','نعم أؤكد إنشاء الحالة وأطلب مراجعة بشرية.'] : ['I want to complain and request human review.','Saeed Al Hashimi, SR-1042, delayed permit renewal.','Yes, I confirm and request human review.']) {
    messages.push({ role:'user',content });
    final = await runServiceAgent({ model,version:baselineVersion,messages,sandbox:{ driver:db.driver,tenant,requesterKey:'saeed' },conversationKey:tenant });
    messages = final.transcript.filter((m) => m.role !== 'system');
  }
  const rows = (await db.owner.query('SELECT c.reference,c.status,c.queue,e.queue AS review_queue FROM sandbox.cases c JOIN sandbox.escalations e ON c.id=e.case_id WHERE c.tenant=$1',[tenant])).rows;
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ status:'in_review',queue:'complaint_review',review_queue:'complaint_review' });
  expect(final!.reply).toContain(rows[0]!.reference); expect(final!.toolCalls).toHaveLength(4); expect(meta).toHaveLength(7); expect(meta.every((m) => m.provider === 'kilo' && !m.failover)).toBe(true);
  const calls = (await db.owner.query('SELECT task,purpose,workspace_id,conversation_id FROM nazir.ai_calls WHERE conversation_id=$1',[conversationId])).rows;
  expect(calls).toHaveLength(7); expect(calls.every((c) => c.workspace_id === wid && c.task === 'test_run' && c.purpose === 'agent')).toBe(true);
});
it('skips a malformed provider tool argument before executing sandbox tools', async () => {
  const tenant = 'chain_bad_args'; await db.worker(wid,(conn) => conn.query('SELECT sandbox.seed_tenant($1)',[tenant]));
  let count = 0; const metas: CallMeta[] = [];
  const fetch: typeof globalThis.fetch = async () => Response.json({ choices:[{ message: ++count === 1 ? call('create_case',{ category:true }) : count === 2 ? call('create_case',{ category:'complaint',summary:'Delay',prior_request_ref:'SR-1042',requester_name:'Saeed' }) : { content:'Created.' } }] });
  let time = Date.now();
  const chain = createAiChain({ fetch,store:postgresAiStore(db.driver),env:{ REQUESTY_API_KEY:'test-key' },now:() => time,sleep:async (ms) => { time += ms; } });
  const model = chainChatModel(chain,{ task:'live_demo',onCall:(m) => metas.push(m) });
  const result = await runServiceAgent({ model,version:baselineVersion,messages:[],sandbox:{ driver:db.driver,tenant,requesterKey:'saeed' },conversationKey:tenant });
  expect(result.toolCalls).toHaveLength(1); expect(result.toolCalls[0]!.result.ok).toBe(true); expect(metas[0]).toMatchObject({ provider:'requesty',failover:true,failoverReason:'invalid_tool_args' });
  expect((await db.owner.query('SELECT * FROM sandbox.tool_receipts WHERE tenant=$1',[tenant])).rows).toHaveLength(1);
});
