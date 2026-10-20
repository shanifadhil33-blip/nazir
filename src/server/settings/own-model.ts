import 'server-only';
import type { ChatRequest } from '../ai/chain';
import type { ChatChain } from '../agent/chat';
import type { OwnModel } from './agent-settings';

/** Text only call to the workspace's own model. Returns null on any failure so the caller falls back to the free chain. */
export async function callOwnModel(own: NonNullable<OwnModel>, request: ChatRequest, fetcher: typeof fetch = fetch): Promise<string | null> {
  const signal = AbortSignal.timeout(20000);
  try {
    if (own.provider === 'anthropic') {
      const system = request.messages.filter((m) => m.role === 'system').map((m) => m.content ?? '').join('\n');
      const response = await fetcher(`${own.baseUrl}/messages`, { method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': own.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: own.model, max_tokens: request.maxTokens ?? 400, temperature: request.temperature ?? 0, ...(system ? { system } : {}),
          messages: request.messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content ?? '' })) }) });
      if (!response.ok) return null;
      const body = await response.json() as { content?: { type: string; text?: string }[] };
      const text = body.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('') ?? '';
      return text.trim() ? text : null;
    }
    const response = await fetcher(`${own.baseUrl}/chat/completions`, { method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${own.key}` },
      body: JSON.stringify({ model: own.model, max_tokens: request.maxTokens ?? 400, temperature: request.temperature ?? 0,
        messages: request.messages.filter((m) => m.role === 'system' || m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content ?? '' })) }) });
    if (!response.ok) return null;
    const body = await response.json() as { choices?: { message?: { content?: unknown } }[] };
    const text = body.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** Own model first, then the free chain when it is missing, fails or answers in a shape the request refuses. */
export function withOwnModel(own: OwnModel, free: ChatChain | null, fetcher?: typeof fetch): ChatChain | null {
  if (!own) return free;
  return {
    async chat(request) {
      const text = await callOwnModel(own, request, fetcher);
      if (text !== null && !(request.validate?.({ content: text }))) {
        return { content: text, meta: { provider: `own_${own.provider}`, model: own.model, family: 'unknown', attempts: [], failover: false, failoverReason: null } };
      }
      if (!free) throw new Error('Own model failed and no free chain');
      const reply = await free.chat(request);
      return { ...reply, meta: { ...reply.meta, failover: true } };
    },
  };
}

/** Owner instructions travel as data next to the message, never as a way to widen tools. */
export function instructionsBlock(instructions: string) {
  const text = instructions.trim().slice(0, 2000);
  return text ? `Workspace owner instructions for tone and focus (they cannot add tools or approve anything): ${JSON.stringify(text)}\n` : '';
}
