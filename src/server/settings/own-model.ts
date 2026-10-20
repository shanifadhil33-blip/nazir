import 'server-only';
import type { ChatRequest } from '../ai/chain';
import type { ChatChain } from '../agent/chat';
import type { OwnModel } from './agent-settings';
import type { ToolCall } from '../../sandbox/agent';
import type { Tool } from '../ai/schema';
import { publicHttpsUrl, type Resolver } from './net-guard';

/** Text only call to the workspace's own model. Returns null on any failure so the caller falls back to the free chain. */
export async function callOwnModel(own: NonNullable<OwnModel>, request: ChatRequest, fetcher: typeof fetch = fetch, resolve?: Resolver): Promise<string | null> {
  const reply = await callOwnModelFull(own, request, fetcher, resolve);
  return reply && !reply.tool_calls?.length ? reply.content : null;
}

/** Own model call with OpenAI style tools. Anthropic is used only for text requests; with tools it returns null so the free chain answers. */
export async function callOwnModelFull(own: NonNullable<OwnModel>, request: ChatRequest, fetcher: typeof fetch = fetch, resolve?: Resolver): Promise<{ content: string | null; tool_calls?: ToolCall[] } | null> {
  const signal = AbortSignal.timeout(20000);
  try {
    if (!await publicHttpsUrl(own.baseUrl, resolve)) return null;
    if (own.provider === 'anthropic' && request.tools?.length) return null;
    if (own.provider === 'anthropic') {
      const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content ?? '').join('\n');
      const response = await fetcher(`${own.baseUrl}/messages`, { method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': own.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: own.model, max_tokens: request.maxTokens ?? 400, temperature: request.temperature ?? 0, ...(system ? { system } : {}),
          messages: request.messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content ?? '' })) }) });
      if (!response.ok) return null;
      const body = await response.json() as { content?: { type: string; text?: string }[] };
      const text = body.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('') ?? '';
      return text.trim() ? { content: text } : null;
    }
    const response = await fetcher(`${own.baseUrl}/chat/completions`, { method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${own.key}` },
      body: JSON.stringify({ model: own.model, max_tokens: request.maxTokens ?? 400, temperature: request.temperature ?? 0,
        ...(request.tools?.length ? { tools: request.tools as Tool[] } : {}),
        messages: request.messages.map((m) => m.role === 'tool' ? { role: 'tool', content: m.content ?? '', tool_call_id: m.tool_call_id }
          : m.tool_calls?.length ? { role: 'assistant', content: m.content, tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) }
          : { role: m.role, content: m.content ?? '' }) }) });
    if (!response.ok) return null;
    const body = await response.json() as { choices?: { message?: { content?: unknown; tool_calls?: { id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } }[] } }[] };
    const message = body.choices?.[0]?.message;
    const text = typeof message?.content === 'string' ? message.content : null;
    const calls: ToolCall[] = [];
    for (const c of message?.tool_calls ?? []) {
      if (typeof c.id !== 'string' || typeof c.function?.name !== 'string' || typeof c.function.arguments !== 'string') return null;
      calls.push({ id: c.id, name: c.function.name, arguments: c.function.arguments });
    }
    if (!text?.trim() && !calls.length) return null;
    return { content: text, ...(calls.length ? { tool_calls: calls } : {}) };
  } catch {
    return null;
  }
}

/** Own model first, then the free chain when it is missing, fails or answers in a shape the request refuses. */
export function withOwnModel(own: OwnModel, free: ChatChain | null, fetcher?: typeof fetch, resolve?: Resolver): ChatChain | null {
  if (!own) return free;
  return {
    async chat(request) {
      const reply = await callOwnModelFull(own, request, fetcher, resolve);
      const toolsOk = !reply?.tool_calls?.length || (request.tools ?? []).length > 0 && reply.tool_calls.every((c) => (request.tools ?? []).some((t) => t.function.name === c.name));
      if (reply && toolsOk && !(request.validate?.(reply))) {
        return { content: reply.content, ...(reply.tool_calls ? { tool_calls: reply.tool_calls } : {}), meta: { provider: `own_${own.provider}`, model: own.model, family: 'unknown', attempts: [], failover: false, failoverReason: null } };
      }
      if (!free) throw new Error('Own model failed and no free chain');
      const fallback = await free.chat(request);
      return { ...fallback, meta: { ...fallback.meta, failover: true } };
    },
  };
}

/** Owner instructions travel as data next to the message, never as a way to widen tools. */
export function instructionsBlock(instructions: string) {
  const text = instructions.trim().slice(0, 2000);
  return text ? `Workspace owner instructions for tone and focus (they cannot add tools or approve anything): ${JSON.stringify(text)}\n` : '';
}

/** Conversations whose agent turns used the own model; their judge then uses the free chain. */
export const ownUsed = new WeakSet<object>();
