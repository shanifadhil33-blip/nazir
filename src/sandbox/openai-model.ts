import type { ChatModel, ToolCall } from './agent';
export function openAiCompatibleModel({ url, apiKey, model, timeoutMs }: { url: string; apiKey?: string; model: string; timeoutMs: number }): ChatModel {
  return async ({ messages, tools }) => {
    const response = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, messages: messages.map((message) => ({ ...message, ...(message.tool_calls ? { tool_calls: message.tool_calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) })), tools, temperature: 0, max_tokens: 800 }),
    });
    if (!response.ok) throw new Error('Model request failed');
    const body = await response.json();
    const message = body.choices?.[0]?.message;
    if (!message || (message.content !== null && typeof message.content !== 'string')) throw new Error('Invalid model response');
    const calls: ToolCall[] | undefined = message.tool_calls?.map((call: { id: string; function: { name: string; arguments: string } }) => {
      if (typeof call.id !== 'string' || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string') throw new Error('Invalid tool call');
      return { id: call.id, name: call.function.name, arguments: call.function.arguments };
    });
    return { content: message.content, ...(calls ? { tool_calls: calls } : {}) };
  };
}
