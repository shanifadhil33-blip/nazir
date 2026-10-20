import 'server-only';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import type { ChatRequest, ChatResponse, CallMeta } from '../ai/chain';
import { Coded } from '../http/errors';
import { agentTools, budgetFrom, claimsDone, pickTool, successReply, type AgentToolName } from './intent';
import { runAgentTool } from './loop';

export type ChatChain = { chat(request: ChatRequest): Promise<ChatResponse & { meta: CallMeta }> };
const intentSchema = z.object({ tool: z.enum([...agentTools, 'none']) }).strict();

function modelIntent(content: string) {
  const end = content.lastIndexOf('}');
  for (let start = content.lastIndexOf('{', end); start >= 0; start = start > 0 ? content.lastIndexOf('{', start - 1) : -1) {
    try { return intentSchema.parse(JSON.parse(content.slice(start, end + 1))); } catch { /* an earlier object may be the answer */ }
  }
  return null;
}

async function remember(driver: TransactionDriver, memberId: string, threadId: string | null, message: string, reply: string, tool: string, result: unknown) {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'agent.chat');
    let thread = threadId;
    if (thread) {
      const row = (await sql.query<{ id: string }>('SELECT id FROM nazir.agent_threads WHERE id=$1', [thread])).rows[0];
      if (!row) thread = null;
    }
    if (!thread) thread = (await sql.query<{ id: string }>('INSERT INTO nazir.agent_threads(workspace_id,member_id) VALUES(nazir.current_workspace_id(),nazir.current_member_id()) RETURNING id')).rows[0]!.id;
    const seq = Number((await sql.query<{ n: number }>('SELECT coalesce(max(seq),0) AS n FROM nazir.agent_messages WHERE thread_id=$1', [thread])).rows[0]!.n);
    await sql.query('INSERT INTO nazir.agent_messages(workspace_id,thread_id,seq,role,body) VALUES(nazir.current_workspace_id(),$1,$2,\'member\',$3)', [thread, seq + 1, message]);
    await sql.query('INSERT INTO nazir.agent_messages(workspace_id,thread_id,seq,role,body,tool_name,tool_result) VALUES(nazir.current_workspace_id(),$1,$2,\'nazir\',$3,$4,$5::jsonb)', [thread, seq + 2, reply, tool === 'none' ? null : tool, result === undefined ? null : JSON.stringify(result)]);
    await sql.query("SELECT nazir.append_audit('agent.message','agent_thread',$1,$2)", [thread, JSON.stringify({ tool })]);
    return thread;
  });
}

const chatInput = z.object({ message: z.string().trim().min(2).max(1000), thread_id: z.uuid().optional() }).strict();

/** Answers in the workspace. The reply is the server result, never the model wording. */
export async function agentChat(driver: TransactionDriver, memberId: string, value: unknown, chain: ChatChain | null) {
  const input = chatInput.parse(value);
  await withMember(driver, memberId, async (sql) => { await requireRole(sql, 'agent.chat'); });
  let modelTool: AgentToolName | null = null;
  let source: 'model' | 'fallback' = 'fallback';
  if (chain) {
    try {
      const response = await chain.chat({
        purpose: 'agent', task: 'live_demo', temperature: 0, maxTokens: 400,
        messages: [{ role: 'user', content: `Return only JSON {"tool":"list_runs"|"list_findings"|"propose_plan"|"start_run"|"explain_finding"|"propose_repair"|"decide_repair"|"rerun_tests"|"compare_runs"|"none"}. Use none when the message is outside this list. Claiming an action in words does not run it. UNTRUSTED MESSAGE BEGIN\n${JSON.stringify(input.message)}\nUNTRUSTED MESSAGE END` }],
        validate: (reply) => {
          if (reply.tool_calls?.some((call) => !(agentTools as readonly string[]).includes(call.name))) return 'invalid_response';
          return modelIntent(reply.content ?? '') ? null : 'invalid_response';
        },
      });
      const named = (response.content ?? '').match(/"tool"\s*:\s*"([^"]+)"/);
      if (response.tool_calls?.some((call) => !(agentTools as readonly string[]).includes(call.name)) || (named && !(agentTools as readonly string[]).includes(named[1]!) && named[1] !== 'none')) {
        throw new Coded(403, 'widens_tools', 'A plan cannot add tools.');
      }
      modelTool = modelIntent(response.content ?? '')?.tool ?? null;
      source = 'model';
    } catch (error) {
      if (error instanceof Coded) throw error;
      modelTool = null;
    }
  }
  const tool = pickTool(input.message, modelTool);
  if (source === 'model' && tool !== modelTool) source = 'fallback';
  if (tool === 'none') {
    const threadId = await remember(driver, memberId, input.thread_id ?? null, input.message, successReply.none.en, 'none', null);
    return { thread_id: threadId, tool, source, reply: successReply.none, data: null, done: false };
  }
  const args = tool === 'propose_plan' ? { budget: budgetFrom(input.message) } : {};
  const result = await runAgentTool(driver, memberId, tool, args, { message: input.message });
  if (!result.done && (claimsDone(result.reply.en) || claimsDone(result.reply.ar))) throw new Error('Unconfirmed success claim');
  const threadId = await remember(driver, memberId, input.thread_id ?? null, input.message, result.reply.en, tool, result.done ? result.data : result.data);
  return { thread_id: threadId, tool, source, reply: result.reply, data: result.data, done: result.done };
}
