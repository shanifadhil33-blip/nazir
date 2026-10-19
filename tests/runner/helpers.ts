import { createRunnerFixture } from '../../src/server/runner/fixture';
import { enqueueRun } from '../../src/server/runner/enqueue';
import type { TestDatabase } from '../helpers/pglite';
import type { ChatModel, Message } from '../../src/sandbox/agent';
export const fixture = (db: TestDatabase,label: string) => db.driver.transaction((sql) => createRunnerFixture(sql,label));
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export function enqueue(db: TestDatabase,f: Fixture,version='baseline',language='en',repeats=1) {
  return enqueueRun(db.driver,{ workspaceId:f.workspaceId,planId:f.planId,agentVersionId:f.versions.find((v) => v.registry_id===version)!.id,scenarioIds:f.scenarios.filter((s) => s.language===language).map((s) => s.id),repeats,idempotencyKey:crypto.randomUUID() });
}
export async function claim(db: TestDatabase,worker='test_worker') {
  return db.driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_worker'); return (await sql.query<{ workspace_id: string; conversation_id: string; run_id: string; attempt: number }>('SELECT * FROM nazir.runner_claim($1,60)',[worker])).rows[0]; });
}
export function journey(): ChatModel {
  return async ({ messages }) => {
    const user=messages.filter((m) => m.role==='user').at(-1)!.content!;
    const ar=user.includes('أ');
    if (!user.includes('confirm') && !user.includes('أؤكد')) return { content:'Please confirm the request.' };
    const results=messages.filter((m) => m.role==='tool').map((m) => JSON.parse(m.content!));
    const call=(name: string,args: unknown) => ({ content:null,tool_calls:[{ id:crypto.randomUUID(),name,arguments:JSON.stringify(args) }] });
    if (!results.length) return call('get_service_policy',{});
    if (results.length===1) return call('create_case',{ category:'complaint',summary:ar?'تأخر الطلب':'Delayed request',requester_name:ar?'عمران قريشي':'Saeed Al Hashimi',prior_request_ref:ar?'SR-2077':'SR-1042' });
    if (!results[1].ok) return { content:'The request failed.' };
    const reference=results[1].data.reference;
    if (results.length===2) return call('get_case_status',{ reference });
    if (results.length===3) return call('request_human_review',{ reference,reason:'Please review this request' });
    return { content:`Case ${reference} sent for review.` };
  };
}
export function httpReply(response: Awaited<ReturnType<ChatModel>>) {
  return { ...response,tool_calls:response.tool_calls?.map((c) => ({ id:c.id,type:'function',function:{ name:c.name,arguments:c.arguments } })) };
}
export function requestMessages(init?: RequestInit): Message[] {
  type WireMessage = Omit<Message,'tool_calls'> & { tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
  const body = JSON.parse(init!.body as string) as { messages: WireMessage[] };
  return body.messages.map((m) => ({ ...m,tool_calls:m.tool_calls?.map((c) => ({ id:c.id,name:c.function.name,arguments:c.function.arguments })) }));
}
