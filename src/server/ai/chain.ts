import type { Message, ToolCall } from '../../sandbox/agent';
import { capValue, chainOrder, providerRegistry, type Env, type Family } from './providers';
import { matchesSchema, type Tool } from './schema';
import type { AiStateStore, Attempt, Cooldown, Reason, Task } from './store';
export type ChatResponse = { content: string | null; tool_calls?: ToolCall[]; truncated?: true };
export type CallMeta = { provider: string; model: string; family: Family; attempts: Attempt[]; failover: boolean; failoverReason: Reason | null };
export type ChatRequest = {
  purpose: 'agent' | 'judge'; task: Task; messages: Message[]; tools?: Tool[]; maxTokens?: number; temperature?: number;
  validate?: (response: ChatResponse) => string | null; agentFamily?: Family; agentFamilies?: Family[]; externalAgent?: boolean; conversationId?: string; workspaceId?: string; deadlineMs?: number;
};
export class AiChainExhausted extends Error {
  constructor(public readonly attempts: Attempt[]) { super('AI chain exhausted'); this.name = 'AiChainExhausted'; }
}
class TimeLimit extends Error {}
// A shared clock identifies a process scheduler. Tests inject independent clocks.
type Queue = { tail: Promise<void>; starts: Map<string, number> };
const schedulers = new WeakMap<() => number, { queues: Map<string, Queue>; cooldowns: Map<string, Cooldown> }>();
function timed<T>(work: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return Promise.reject(new TimeLimit());
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeLimit()), ms); })]).finally(() => clearTimeout(timer));
}
export function redactProviderText(text: string, env: Env): string {
  const values = Object.entries(env).filter(([name, value]) => value && (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name) || /^(sk-|AIza|nvapi-)/.test(value))).map(([, value]) => value!);
  return values.sort((a,b) => b.length - a.length).reduce((result, value) => result.split(value).join('[redacted]'), text).slice(0,200);
}
function cooldownDuration(reason: Reason): number {
  return reason === 'day_used' ? 3600000 : reason === 'rate_limited' ? 60000 : reason === 'payment_required' || reason === 'auth_failed' ? 86400000 : 0;
}
function parseReply(body: unknown): ChatResponse | null {
  if (!body || typeof body !== 'object' || !('choices' in body) || !Array.isArray(body.choices)) return null;
  const raw = body.choices[0]?.message;
  // Some providers (OVH gpt-oss, Requesty) omit content entirely on a tool call reply; treat a missing content as null.
  const message = raw && typeof raw === 'object' ? { ...raw, content: raw.content === undefined ? null : raw.content } : raw;
  if (!message || (message.content !== null && typeof message.content !== 'string')) return null;
  let calls: ToolCall[] | undefined;
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) return null;
    calls = [];
    for (const call of message.tool_calls) {
      if (!call || call.type !== 'function' || typeof call.id !== 'string' || !call.id || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string') return null;
      calls.push({ id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
  }
  const truncated = body.choices[0]?.finish_reason === 'length';
  if (!message.content?.trim() && !calls?.length) return null;
  return { content: message.content, ...(calls?.length ? { tool_calls: calls } : {}), ...(truncated ? { truncated: true } : {}) };
}
function validTools(reply: ChatResponse, tools: Tool[]): boolean {
  return (reply.tool_calls ?? []).every((call) => {
    const tool = tools.find((tool) => tool.function.name === call.name);
    if (!tool) return false;
    try { return matchesSchema(JSON.parse(call.arguments), tool.function.parameters); } catch { return false; }
  });
}
export function createAiChain({ fetch: fetcher = globalThis.fetch, store, now = Date.now, sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)), env = process.env, forcedDown = new Set<string>() }: {
  fetch?: typeof globalThis.fetch; store: AiStateStore; now?: () => number; sleep?: (ms: number) => Promise<void>; env?: Env; forcedDown?: ReadonlySet<string>;
}) {
  const providers = providerRegistry(env);
  let scheduler = schedulers.get(now);
  if (!scheduler) { scheduler = { queues: new Map(), cooldowns: new Map() }; schedulers.set(now, scheduler); }
  const { queues, cooldowns } = scheduler;
  const taskCaps = { test_run: capValue(env.AI_DAILY_CAP_TEST_RUN,300), live_demo: capValue(env.AI_DAILY_CAP_LIVE_DEMO,400), probe: capValue(env.AI_DAILY_CAP_PROBE,40) };
  return {
    async chat(request: ChatRequest): Promise<ChatResponse & { meta: CallMeta }> {
      const plan = chainOrder(providers, request.purpose, request.agentFamilies ?? request.agentFamily, request.externalAgent);
      if (!Object.hasOwn(taskCaps, request.task)) throw new Error('Invalid AI task');
      const budget = request.deadlineMs ?? 90000;
      if (!Number.isFinite(budget) || budget <= 0) throw new Error('Invalid AI deadline');
      const end = now() + budget;
      const wallEnd = Date.now() + budget;
      const remaining = () => Math.min(end - now(), wallEnd - Date.now());
      const attempts: Attempt[] = [];
      const remember = (c: Cooldown) => { const key = c.provider + '/' + c.model; if ((cooldowns.get(key)?.until ?? 0) < c.until) cooldowns.set(key,c); };
      // Read once per chat; local entries also cover concurrent chats in this process.
      try { for (const row of await timed(store.activeCooldowns(), remaining())) remember(row); }
      catch (error) { if (!(error instanceof TimeLimit)) throw new Error('AI state unavailable'); }
      for (const entry of plan) {
        const { provider, model, family } = entry;
        let at = now(), status: number | null = null;
        let reason: Reason = 'invalid_response', outcome: Attempt['outcome'] = 'skipped';
        let reply: ChatResponse | null = null;
        const cooling = () => [provider.id + '/*', provider.id + '/' + model].some((key) => (cooldowns.get(key)?.until ?? 0) > now());
        if (remaining() <= 0) reason = 'deadline';
        else if (forcedDown.has(provider.id) || forcedDown.has(provider.id + '/' + model)) { reason = 'forced_down'; outcome = 'error'; }
        else if ((provider.keyEnv && !env[provider.keyEnv]) || (provider.needsEnv && !env[provider.needsEnv])) reason = 'no_key';
        else if (cooling()) reason = 'cooling';
        else {
          let queue = queues.get(provider.id);
          if (!queue) { queue = { tail: Promise.resolve(), starts: new Map() }; queues.set(provider.id,queue); }
          const previous = queue.tail;
          let release!: () => void;
          queue.tail = new Promise<void>((resolve) => { release = resolve; });
          let acquired = false;
          try {
            await timed(previous, remaining()); acquired = true;
            const spacingKey = provider.perModelSpacing ? model : '*';
            for (;;) {
              const wait = (queue.starts.get(spacingKey) ?? -Infinity) + provider.minSpacingMs - now();
              if (wait <= 0) break;
              await timed(sleep(wait), remaining());
            }
            if (remaining() <= 0) throw new TimeLimit();
            if (cooling()) reason = 'cooling';
            else if (!await timed(store.reserve(request.task,provider.id,model,taskCaps[request.task],provider.cap),remaining())) reason = 'cap_reached';
            else {
              at = now(); outcome = 'error';
              queue.starts.set(spacingKey, at);
              const controller = new AbortController();
              // A judge reads a longer prompt than an agent turn; Requesty Gemma took 8 to 10 s on 19 Oct and timed out at 12 s.
              const limit = Math.min(request.purpose==='judge' ? provider.judgeTimeoutMs ?? provider.timeoutMs : provider.timeoutMs,remaining());
              let timeout = false;
              const timer = setTimeout(() => { timeout = true; controller.abort(); }, Math.max(0,limit));
              try {
                const body = await timed((async () => {
                  const response = await fetcher(provider.url, {
                    method: 'POST', signal: controller.signal,
                    headers: { 'Content-Type': 'application/json', ...(provider.keyEnv ? { Authorization: `Bearer ${env[provider.keyEnv]}` } : {}) },
                    body: JSON.stringify({ model, messages: request.messages.map((m) => {
                      const message = { ...m };
                      delete message.truncated;
                      return { ...message, ...(message.tool_calls ? { tool_calls: message.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}) };
                    }), ...(request.tools?.length ? { tools: request.tools, tool_choice: 'auto' } : {}), max_tokens: request.maxTokens ?? (request.purpose === 'agent' ? 2000 : 800), temperature: request.temperature ?? 0 }),
                  });
                  status = response.status;
                  const text = await response.text();
                  if (!response.ok) {
                    const safe = redactProviderText(text,env);
                    reason = status === 429 ? (/per.day|daily|neurons|free-models-per-day|quota/i.test(safe) ? 'day_used' : 'rate_limited') : status === 402 ? 'payment_required' : status === 401 || status === 403 ? 'auth_failed' : status >= 500 ? 'http_5xx' : 'invalid_response';
                    return null;
                  }
                  try { return parseReply(JSON.parse(text)); } catch { return null; }
                })(),limit);
                if (remaining() <= 0) reason = 'deadline';
                else if (body) {
                  reply = body;
                  if (!validTools(body,request.tools ?? [])) reason = 'invalid_tool_args';
                  else {
                    let validation: string | null = null;
                    try { validation = request.validate?.(body) ?? null; } catch { validation = 'invalid_response'; }
                    reason = validation === null ? 'ok' : validation === 'invalid_tool_args' ? 'invalid_tool_args' : 'invalid_response';
                    if (reason === 'ok') outcome = 'ok';
                  }
                }
              } catch (error) {
                reason = remaining() <= 0 ? 'deadline' : error instanceof TimeLimit || timeout || (error instanceof Error && /TimeoutError|AbortError/.test(error.name)) ? 'timeout' : 'network';
              } finally { clearTimeout(timer); controller.abort(); }
              const duration = cooldownDuration(reason);
              if (duration) {
                const c: Cooldown = { provider: provider.id, model: duration === 86400000 ? '*' : model, until: now() + duration, reason };
                remember(c); await store.cool(c);
              }
            }
          } catch (error) {
            if (error instanceof TimeLimit) reason = 'deadline';
            else throw new Error('AI state unavailable');
          } finally {
            if (acquired) release(); else void previous.then(release);
          }
        }
        const attempt: Attempt = { provider: provider.id, model, family, outcome, reason, httpStatus: status, latencyMs: Math.max(0,Math.round(now() - at)) };
        attempts.push(attempt);
        await store.record({ ...attempt, at, task: request.task, purpose: request.purpose, failover: attempts.slice(0, -1).some((item) => item.reason !== 'no_key'), attemptNo: attempts.length, workspaceId: request.workspaceId, conversationId: request.conversationId });
        // A provider with no key configured is not a failover: the chain simply starts at the first configured model.
        const tried = attempts.filter((item) => item.reason !== 'no_key');
        if (outcome === 'ok' && reply) return { ...reply, meta: { provider: provider.id, model, family, attempts, failover: tried.length > 1, failoverReason: tried.length > 1 ? tried[0]!.reason : null } };
        if (reason === 'deadline') break;
      }
      throw new AiChainExhausted(attempts);
    },
  };
}
export type AiChain = ReturnType<typeof createAiChain>;
