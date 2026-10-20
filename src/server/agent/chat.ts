import 'server-only';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import type { ChatRequest, ChatResponse, CallMeta } from '../ai/chain';
import { budgetInput, plannerTools, type PlannerTool } from '../planner/bound';
import { Coded } from '../http/errors';
import { runPlannerTool } from './tools';

export type ChatChain = { chat(request: ChatRequest): Promise<ChatResponse & { meta: CallMeta }> };
const intentSchema = z.object({ tool: z.enum([...plannerTools, 'none']) }).strict();
export const chatReplies = {
  list_runs: { en: 'Here are the test runs.', ar: 'هذه تشغيلات الاختبار.' },
  list_findings: { en: 'Here are the findings.', ar: 'هذه النتائج.' },
  propose_plan: { en: 'I proposed a plan within the budget.', ar: 'اقترحت خطة ضمن الميزانية.' },
  none: { en: 'I can list runs, list findings, or propose a plan.', ar: 'أستطيع عرض التشغيلات، أو عرض النتائج، أو اقتراح خطة.' },
  missing: { en: 'There is no approved version to test.', ar: 'لا توجد نسخة معتمدة للاختبار.' },
};

/** Reads a short request. Anything outside the three tools is ignored here and refused by the tool runner. */
export function chatIntent(message: string): PlannerTool | 'none' {
  if (/اقترح خطة|propose (?:a )?plan/i.test(message)) return 'propose_plan';
  if (/اعرض النتائج|أظهر النتائج|list findings/i.test(message)) return 'list_findings';
  if (/اعرض التشغيلات|أظهر التشغيلات|list runs/i.test(message)) return 'list_runs';
  return 'none';
}

export function budgetFrom(message: string) {
  const cost = message.match(/(\d{1,6})\s*cost(?:\s*per\s*call\s*(\d{1,6}))?/i);
  if (cost?.[1]) return budgetInput.parse({ kind: 'cost', max: Number(cost[1]), perCall: Number(cost[2] ?? 1) });
  const calls = message.match(/(\d{1,6})\s*(?:calls|مكالمات)/);
  if (calls?.[1]) return budgetInput.parse({ kind: 'calls', max: Number(calls[1]) });
  return { kind: 'calls' as const, max: 8 };
}

function modelIntent(content: string) {
  const end = content.lastIndexOf('}');
  for (let start = content.lastIndexOf('{', end); start >= 0; start = start > 0 ? content.lastIndexOf('{', start - 1) : -1) {
    try { return intentSchema.parse(JSON.parse(content.slice(start, end + 1))); } catch { /* an earlier object may be the answer */ }
  }
  return null;
}

async function versions(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => {
    const agent = (await sql.query<{ id: string }>('SELECT id FROM nazir.agent_versions ORDER BY created_at DESC,id LIMIT 1')).rows[0];
    const rules = (await sql.query<{ id: string }>("SELECT id FROM nazir.rule_pack_versions WHERE status='approved' ORDER BY created_at DESC,id LIMIT 1")).rows[0];
    return { agent_version_id: agent?.id ?? null, rule_pack_version_id: rules?.id ?? null };
  });
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

/** Answers in the workspace, using the free chain when one is passed and the same permission checks as the APIs. */
export async function agentChat(driver: TransactionDriver, memberId: string, value: unknown, chain: ChatChain | null) {
  const input = chatInput.parse(value);
  await withMember(driver, memberId, async (sql) => { await requireRole(sql, 'agent.chat'); });
  let tool: PlannerTool | 'none' = 'none';
  let source: 'model' | 'fallback' = 'fallback';
  if (chain) {
    try {
      const response = await chain.chat({
        purpose: 'agent', task: 'live_demo', temperature: 0, maxTokens: 400,
        messages: [{ role: 'user', content: `Return only JSON {"tool":"list_runs"|"list_findings"|"propose_plan"|"none"}. Use none when the message asks for any other tool. UNTRUSTED MESSAGE BEGIN\n${JSON.stringify(input.message)}\nUNTRUSTED MESSAGE END` }],
        validate: (reply) => {
          if (reply.tool_calls?.some((call) => !(plannerTools as readonly string[]).includes(call.name))) return 'invalid_response';
          return modelIntent(reply.content ?? '') ? null : 'invalid_response';
        },
      });
      const named = (response.content ?? '').match(/"tool"\s*:\s*"([^"]+)"/);
      if (response.tool_calls?.some((call) => !(plannerTools as readonly string[]).includes(call.name)) || (named && !(plannerTools as readonly string[]).includes(named[1]!) && named[1] !== 'none')) {
        throw new Coded(403, 'widens_tools', 'A plan cannot add tools.');
      }
      tool = modelIntent(response.content ?? '')?.tool ?? chatIntent(input.message);
      source = 'model';
    } catch (error) {
      if (error instanceof Coded) throw error;
      tool = chatIntent(input.message);
    }
  } else tool = chatIntent(input.message);
  if (tool === 'none') {
    const threadId = await remember(driver, memberId, input.thread_id ?? null, input.message, chatReplies.none.en, 'none', null);
    return { thread_id: threadId, tool, source, reply: chatReplies.none, data: null };
  }
  let args: unknown = {};
  if (tool === 'propose_plan') {
    await withMember(driver, memberId, async (sql) => { await requireRole(sql, 'plan.propose'); });
    const found = await versions(driver, memberId);
    if (!found.agent_version_id || !found.rule_pack_version_id) {
      const threadId = await remember(driver, memberId, input.thread_id ?? null, input.message, chatReplies.missing.en, 'none', null);
      return { thread_id: threadId, tool: 'none' as const, source, reply: chatReplies.missing, data: null };
    }
    args = { agent_version_id: found.agent_version_id, rule_pack_version_id: found.rule_pack_version_id, budget: budgetFrom(input.message) };
  }
  const data = await runPlannerTool(driver, memberId, tool, args);
  const threadId = await remember(driver, memberId, input.thread_id ?? null, input.message, chatReplies[tool].en, tool, { ok: true });
  return { thread_id: threadId, tool, source, reply: chatReplies[tool], data };
}
