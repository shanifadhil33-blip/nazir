// Nazir SDK 1.0.0 for Node 18 or newer. One file, no dependencies.
// It does nothing unless Nazir signed the request. Real user traffic is never sent anywhere.
// Docs: https://nazir-liard.vercel.app/docs/sdk
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

export const VERSION = '1.0.0';
const DEFAULT_URL = 'https://nazir-liard.vercel.app';
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_VALUE = 8192;
const SEND_TIMEOUT_MS = 2000;
const SECRET_NAME = /(^|[._-])(key|api[._-]?key|token|secret|password|passwd|authorization|auth|cookie|credential)s?($|[._-])/i;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const hex = (bytes) => randomBytes(bytes).toString('hex');

function luhn(digits) {
  let sum = 0; let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d; double = !double;
  }
  return sum % 10 === 0;
}
/** Masks emails, phones, Emirates ID, card numbers, IBAN and passport like numbers before anything leaves. */
export function redact(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g, '[emirates id]')
    .replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g, '[iban]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && luhn(d) ? '[card]' : m; })
    .replace(/(?:\+|00)\d[\d ()-]{7,16}\d|\b0\d{1,2}[ -]?\d{3}[ -]?\d{4}\b/g, '[phone]')
    .replace(/\b[A-Z]{1,2}\d{6,8}\b/g, '[passport]');
}
function safeJson(value) {
  let text;
  try { text = typeof value === 'string' ? value : JSON.stringify(value, (k, v) => (k && SECRET_NAME.test(k) ? undefined : v)); } catch { text = String(value); }
  if (text === undefined) return '';
  return redact(text.length > MAX_VALUE ? text.slice(0, MAX_VALUE) : text);
}
function headersOf(source) {
  const out = {};
  const headers = source?.headers ?? source;
  if (!headers) return out;
  if (typeof headers.get === 'function') {
    for (const name of ['x-nazir-session', 'x-nazir-turn', 'x-nazir-mode', 'x-nazir-signature', 'x-nazir-inject']) { const v = headers.get(name); if (v) out[name] = v; }
    return out;
  }
  for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  return out;
}
function addInject(result, text) {
  if (typeof result === 'string') return `${result}\n\n${text}`;
  if (Array.isArray(result)) return [...result, { title: 'Note', content: text }];
  if (result && typeof result === 'object') return { ...result, note: text };
  return result;
}

export function createNazir(initial = {}) {
  const store = new AsyncLocalStorage();
  const tools = new Map();
  const seen = new Map();
  const state = { key: null, ws: null, url: DEFAULT_URL, agent: {}, described: {}, publicKeys: null, keyCache: null, inventorySent: null, dropped: 0, redact: null };

  function init(options = {}) {
    if (options.key !== undefined) {
      state.key = typeof options.key === 'string' ? options.key : null;
      const match = /^nzk_([0-9a-f]{32})_[0-9A-Za-z]{40}$/.exec(state.key ?? '');
      state.ws = match ? match[1] : null;
    }
    if (options.agent) state.agent = { name: options.agent.name, version: options.agent.version };
    if (options.url) state.url = String(options.url).replace(/\/$/, '');
    if (options.publicKeys) state.publicKeys = options.publicKeys;
    if (typeof options.redact === 'function') state.redact = options.redact;
    return api;
  }
  const disabled = () => process.env.NAZIR_DISABLED === '1' || !state.key || !state.ws || !(state.url.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(state.url));

  async function publicKeys() {
    if (state.publicKeys) return state.publicKeys;
    if (state.keyCache && Date.now() - state.keyCache.at < 24 * 3600_000) return state.keyCache.keys;
    try {
      const response = await fetch(`${state.url}/.well-known/nazir-keys.json`, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
      const body = await response.json();
      const keys = (body.keys ?? []).filter((k) => k.alg === 'Ed25519' && typeof k.public_key === 'string');
      state.keyCache = { at: Date.now(), keys };
      return keys;
    } catch { return state.keyCache?.keys ?? []; }
  }

  /** Every check must pass, or this request is left alone. */
  async function verifyTurn(source) {
    if (disabled()) return null;
    const h = headersOf(source);
    const signature = h['x-nazir-signature']; const session = h['x-nazir-session']; const turn = Number(h['x-nazir-turn']); const mode = h['x-nazir-mode'];
    if (!signature || !/^ses_[0-9a-f]{32}$/.test(session ?? '') || !Number.isInteger(turn) || !['quality', 'security', 'connect'].includes(mode)) return null;
    const parts = Object.fromEntries(String(signature).split(',').map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
    const t = Number(parts.t);
    if (parts.ws !== state.ws || !Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300 || !parts.sig) return null;
    const replay = `${session}:${turn}`;
    for (const [k, at] of seen) if (Date.now() - at > 600_000) seen.delete(k);
    if (seen.has(replay)) return null;
    let inject = '';
    try { inject = h['x-nazir-inject'] ? Buffer.from(h['x-nazir-inject'], 'base64').toString('utf8') : ''; } catch { return null; }
    const payload = Buffer.from(`${t}.${parts.ws}.${session}.${turn}.${mode}.${sha256(inject)}`);
    const keys = (await publicKeys()).filter((k) => !parts.kid || k.kid === parts.kid);
    const ok = keys.some((k) => {
      try { return verify(null, payload, createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(k.public_key, 'base64url')]), format: 'der', type: 'spki' }), Buffer.from(parts.sig, 'base64url')); } catch { return false; }
    });
    if (!ok) return null;
    seen.set(replay, Date.now());
    let injectText = '';
    if (inject) { try { injectText = String(JSON.parse(inject).text ?? ''); } catch { injectText = inject; } }
    return { session, turn, mode, inject: injectText, injected: false, spans: [], trace: sha256(session).slice(0, 32), root: hex(8), started: new Date(), reply: null };
  }

  function push(ctx, span) {
    if (ctx.spans.length >= 95) { state.dropped++; return; }
    ctx.spans.push({ trace_id: ctx.trace, span_id: hex(8), parent_span_id: ctx.root, turn: ctx.turn, status: 'OK', ...span });
  }

  async function send(path, body) {
    try {
      const response = await fetch(`${state.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${state.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
      if (!response.ok) state.dropped++;
    } catch { state.dropped++; }
  }
  function inventory() {
    const d = state.described;
    return {
      model: d.model ?? null,
      tools: [...tools.values()].map((t) => ({ name: t.name, description: t.description ?? null, input_schema: t.inputSchema ?? null, changes_data: !!t.changesData, outside_content: !!t.outsideContent, sends_out: !!t.sendsOut, action: t.action ?? null, source: t.mcp ? 'mcp' : 'code', mcp_server: t.mcp ?? null })),
      mcp_servers: (d.mcpServers ?? []).map((m) => ({ name: m.name, host: (() => { try { return new URL(m.url).host; } catch { return null; } })(), auth: m.auth ?? null, scopes: m.scopes ?? [], tools: m.tools ?? [] })),
      services: d.services ?? [], data_stores: d.dataStores ?? [], permissions: d.permissions ?? [],
    };
  }
  async function flush(ctx) {
    const ended = new Date();
    const reply = typeof ctx.reply === 'string' ? ctx.reply : null;
    const spans = [
      { trace_id: ctx.trace, span_id: ctx.root, parent_span_id: null, turn: ctx.turn, kind: 'invoke_agent', name: `invoke_agent ${state.agent.name ?? 'agent'}`, start: ctx.started.toISOString(), end: ended.toISOString(), status: ctx.error ? 'ERROR' : 'OK',
        attributes: { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': state.agent.name ?? null, 'gen_ai.agent.version': state.agent.version ?? null, 'gen_ai.conversation.id': ctx.session, 'nazir.turn': ctx.turn, 'nazir.mode': ctx.mode } },
      ...ctx.spans,
      { trace_id: ctx.trace, span_id: hex(8), parent_span_id: ctx.root, turn: ctx.turn, kind: 'nazir.hello', name: 'nazir.hello', start: ended.toISOString(), end: ended.toISOString(), status: 'OK', attributes: { 'nazir.sdk.version': VERSION, 'nazir.sdk.dropped': state.dropped } },
      { trace_id: ctx.trace, span_id: hex(8), parent_span_id: ctx.root, turn: ctx.turn, kind: 'nazir.turn.end', name: 'nazir.turn.end', start: ended.toISOString(), end: ended.toISOString(), status: ctx.error ? 'ERROR' : 'OK',
        attributes: { 'nazir.turn': ctx.turn, 'nazir.reply': reply === null ? null : safeJson(reply), 'nazir.reply.sha256': reply === null ? null : sha256(reply) } },
    ].map((span) => (state.redact ? state.redact(span) ?? span : span));
    const jobs = [send('/api/v1/traces', { sdk: { name: 'nazir.mjs', version: VERSION }, agent: state.agent, session: ctx.session, turn: ctx.turn, spans })];
    const inv = inventory(); const hash = sha256(JSON.stringify(inv));
    if (!state.inventorySent || (state.inventorySent.hash !== hash && Date.now() - state.inventorySent.at > 3600_000)) {
      state.inventorySent = { hash, at: Date.now() };
      jobs.push(send('/api/v1/inventory', { sdk: { name: 'nazir.mjs', version: VERSION }, agent: state.agent, inventory: inv }));
    }
    await Promise.allSettled(jobs);
  }

  const noopTurn = { reply() {}, active: false };
  /** Wrap your chat handler. In a signed Nazir test turn, every tool call inside is recorded. */
  async function turn(source, handler) {
    let ctx = null;
    try { ctx = await verifyTurn(source); } catch { ctx = null; }
    if (!ctx) return handler(noopTurn);
    const handle = { active: true, session: ctx.session, mode: ctx.mode, reply(text) { ctx.reply = text; } };
    return store.run(ctx, async () => {
      try { return await handler(handle); }
      catch (error) { ctx.error = error; throw error; }
      finally { try { await flush(ctx); } catch { state.dropped++; } }
    });
  }

  /** Wrap one tool. changesData tools run their dry run (or are blocked) inside a signed test turn. */
  function tool(name, impl, options = {}) {
    tools.set(name, { name, ...options });
    return async function wrapped(...args) {
      const ctx = store.getStore();
      if (!ctx) return impl.apply(this, args);
      const start = new Date();
      const input = args.length === 1 ? args[0] : args;
      let result; let status = 'OK'; let errorType = null; let blocked = false; let dry = false;
      try {
        if (options.changesData) {
          if (typeof options.dryRun === 'function') { dry = true; result = await options.dryRun(...args); }
          else { blocked = true; result = { blocked_by_test_mode: true }; }
        } else result = await impl.apply(this, args);
        if (options.outsideContent && ctx.inject && !ctx.injected) { result = addInject(result, ctx.inject); ctx.injected = true; }
        return result;
      } catch (error) { status = 'ERROR'; errorType = error?.name ?? 'Error'; throw error; }
      finally {
        const attributes = { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, 'gen_ai.tool.type': options.mcp ? 'extension' : 'function',
          'gen_ai.tool.call.arguments': safeJson(input), 'gen_ai.tool.call.result': safeJson(result), 'nazir.dry_run': dry, 'nazir.blocked': blocked, 'nazir.mcp.server': options.mcp ?? null, 'error.type': errorType };
        if (options.action) attributes['nazir.action.type'] = options.action;
        if (typeof options.map === 'function' && status === 'OK') { try { for (const [k, v] of Object.entries(options.map(input, result) ?? {})) attributes[`nazir.action.${k}`] = typeof v === 'string' ? redact(v) : v ?? null; } catch { /* mapping is optional */ } }
        push(ctx, { kind: blocked ? 'nazir.blocked' : 'execute_tool', name: `execute_tool ${name}`, start: start.toISOString(), end: new Date().toISOString(), status, attributes });
      }
    };
  }

  /** Something that is not a tool, like a queue message. Recorded only inside a signed test turn. */
  function action(type, data = {}) {
    const ctx = store.getStore();
    if (!ctx) return;
    const attributes = { 'gen_ai.operation.name': 'nazir.action', 'nazir.action.type': type };
    for (const [k, v] of Object.entries(data)) if (!SECRET_NAME.test(k)) attributes[`nazir.action.${k}`] = typeof v === 'string' ? redact(v) : v ?? null;
    const now = new Date().toISOString();
    push(ctx, { kind: 'nazir.action', name: `nazir.action ${type}`, start: now, end: now, attributes });
  }

  /** The agent map. Tools wrapped with tool() are added for you. Instructions text never leaves. */
  function describe(info = {}) {
    const { instructions: _ignored, ...rest } = info;
    state.described = { ...state.described, ...rest };
    for (const server of rest.mcpServers ?? []) {
      if (server.client?.listTools) Promise.resolve(server.client.listTools()).then((list) => { server.tools = (list?.tools ?? []).map((t) => ({ name: t.name, annotations: t.annotations ?? null })); }).catch(() => {});
    }
    return api;
  }

  /** Records model calls and the tools they asked for. Works with clients shaped like the OpenAI SDK. */
  function wrapOpenAI(client) {
    const create = client?.chat?.completions?.create?.bind(client.chat.completions);
    if (!create) return client;
    client.chat.completions.create = async (params, ...rest) => {
      const ctx = store.getStore();
      if (!ctx) return create(params, ...rest);
      const start = new Date();
      const result = await create(params, ...rest);
      const calls = result?.choices?.[0]?.message?.tool_calls ?? [];
      push(ctx, { kind: 'chat', name: `chat ${params?.model ?? ''}`.trim(), start: start.toISOString(), end: new Date().toISOString(),
        attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': params?.model ?? null, 'nazir.tool_calls': calls.map((c) => c?.function?.name).filter(Boolean).join(',') || null } });
      return result;
    };
    return client;
  }
  /** Traces callTool on an MCP client and adds its tools to the agent map. */
  function wrapMcp(client, server = {}) {
    const call = client?.callTool?.bind(client);
    if (!call) return client;
    const label = server.name ?? 'mcp';
    client.callTool = (request, ...rest) => {
      const name = request?.name ?? 'tool';
      if (!tools.has(`${label}.${name}`)) tools.set(`${label}.${name}`, { name: `${label}.${name}`, mcp: label });
      return tool(`${label}.${name}`, () => call(request, ...rest), { mcp: label, ...(server.tools?.[name] ?? {}) })(request?.arguments ?? {});
    };
    return client;
  }

  const api = { init, describe, tool, turn, action, wrapOpenAI, wrapMcp, redact, VERSION, get active() { return !!store.getStore(); } };
  if (Object.keys(initial).length) init(initial);
  return api;
}

export const nazir = createNazir();
export default nazir;
