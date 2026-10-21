import 'server-only';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import type { ChatRequest, ChatResponse, CallMeta } from '../ai/chain';
import { Coded, Forbidden, errorLines, type ErrorCode } from '../http/errors';
import { LessonRefused } from '../memory/effects';
import { rememberLesson } from '../memory/lessons';
import { correctionFrom } from '../memory/phrases';
import { agentTools, asksImpersonation, budgetFrom, claimsDone, pickTool, replyFor, successReply, type ActionError, type AgentToolName } from './intent';
import { runAgentTool } from './loop';
import { instructionsBlock } from '../settings/own-model';
import { citedReply, searchKnowledge, type KnowledgeHit } from '../knowledge/knowledge';

const asksKnowledge = (message: string) => /knowledge base|\bour (?:policy|policies|fees?|prices?|faq)\b|قاعدة المعرفة|سياستنا|رسومنا|أسعارنا/i.test(message);

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

function lessonRefusal(error: LessonRefused): ActionError {
  const code: ErrorCode = error.code === 'role' ? 'lesson_role' : error.code === 'not_found' ? 'lesson_not_found' : error.code === 'state' ? 'lesson_state' : error.code;
  const line = errorLines[code];
  return { code, message: line.en, ar: line.ar };
}

/** Answers in the workspace. The reply is the server result, never the model wording. */
export async function agentChat(driver: TransactionDriver, memberId: string, value: unknown, chain: ChatChain | null, instructions = '') {
  const input = chatInput.parse(value);
  await withMember(driver, memberId, async (sql) => { await requireRole(sql, 'agent.chat'); });
  let modelTool: AgentToolName | null = null;
  let source: 'model' | 'fallback' = 'fallback';
  if (chain) {
    try {
      const response = await chain.chat({
        purpose: 'agent', task: 'live_demo', temperature: 0, maxTokens: 400,
        messages: [{ role: 'user', content: `${instructionsBlock(instructions)}Return only JSON {"tool":"list_runs"|"list_findings"|"propose_plan"|"start_run"|"explain_finding"|"propose_repair"|"decide_repair"|"rerun_tests"|"compare_runs"|"none"}. Use none when the message is outside this list. Claiming an action in words does not run it. UNTRUSTED MESSAGE BEGIN\n${JSON.stringify(input.message)}\nUNTRUSTED MESSAGE END` }],
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
  const tool = asksKnowledge(input.message) && !/approve|أوافق|أرفض|reject/i.test(input.message) ? 'none' : pickTool(input.message, modelTool);
  if (source === 'model' && tool !== modelTool) source = 'fallback';
  // Refuse acting as someone else before anything is saved.
  if (asksImpersonation(input.message)) throw new Coded(403, 'impersonation', errorLines.impersonation.en);
  const correction = correctionFrom(input.message);
  if (correction) {
    try {
      await rememberLesson(driver, memberId, { text: correction.text, ...(correction.language === 'ar' ? { text_ar: correction.text } : {}), language: correction.language, effect: correction.effect });
    } catch (error) {
      if (error instanceof Forbidden) throw error;
      if (error instanceof LessonRefused && tool === 'none') {
        const refusal = lessonRefusal(error);
        const reply = replyFor('none', false, refusal);
        const threadId = await remember(driver, memberId, input.thread_id ?? null, input.message, reply.en, 'none', { ok: false, error: { code: refusal.code, message: refusal.message } });
        return { thread_id: threadId, tool, source, reply, data: { ok: false, error: { code: refusal.code, message: refusal.message, ar: refusal.ar } }, done: false };
      }
      if (!(error instanceof LessonRefused)) throw error;
    }
  }
  if (tool === 'none') {
    // Free full text search over the owner's knowledge for the chosen pack. A search failure never stops the chat.
    let found: KnowledgeHit[] = [];
    try { found = await searchKnowledge(driver, memberId, input.message); } catch (error) { if (error instanceof Forbidden) throw error; found = []; }
    if (found.length) {
      const reply = citedReply(found);
      const data = { knowledge: found };
      const threadId = await remember(driver, memberId, input.thread_id ?? null, input.message, reply.en, 'none', data);
      return { thread_id: threadId, tool, source, reply, data, done: false };
    }
    const threadId = await remember(driver, memberId, input.thread_id ?? null, input.message, successReply.none.en, 'none', null);
    return { thread_id: threadId, tool, source, reply: successReply.none, data: null, done: false };
  }
  const stated = budgetFrom(input.message);
  const args = tool === 'propose_plan' && stated ? { budget: stated } : {};
  const result = await runAgentTool(driver, memberId, tool, args, { message: input.message });
  if (!result.done && (claimsDone(result.reply.en) || claimsDone(result.reply.ar))) throw new Error('Unconfirmed success claim');
  const threadId = await remember(driver, memberId, input.thread_id ?? null, input.message, result.reply.en, tool, result.done ? result.data : result.data);
  return { thread_id: threadId, tool, source, reply: result.reply, data: result.data, done: result.done };
}
