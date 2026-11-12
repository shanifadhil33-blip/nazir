import 'server-only';
import { z } from 'zod';
import { Coded } from '../http/errors';
import { checkedHttpsAddress, safeHttpsUrl } from '../settings/net-guard';
import { connectFailure, guardedJson, plainReply, type Transport } from './http';

export function safeAuthHeader(v: string) { return /^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(v) && !/^(host|content-type|content-length|connection|transfer-encoding|cookie|proxy-.*|sec-.*|accept-encoding)$/i.test(v); }

export const a2aInterface = z.object({
  url: z.string().max(2000).refine(safeHttpsUrl), transport: z.enum(['JSONRPC', 'HTTP+JSON']), version: z.enum(['1.0', '0.3']),
  headerName: z.string().max(100).refine(safeAuthHeader).optional(), authType: z.enum(['apiKey', 'bearer']).optional(),
}).strict();
export type A2ATransport = Transport & { a2aContexts?: Map<string, string> };
export type A2AInterface = z.infer<typeof a2aInterface>;
export type SafeCard = { name: string; skills: { id: string; name: string }[] };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' ? v : '';


/** Store a small allowlisted projection, never card credentials, instructions or arbitrary metadata. */
export async function discoverA2A(cardUrl: string, auth: { header?: string; key?: string } = {}, options: Transport = {}) {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 10000), ...(options.signal ? [options.signal] : [])]);
  const opts = { ...options, signal };
  const raw = record(await guardedJson(cardUrl, { method: 'GET', headers: auth.key && auth.header ? { [auth.header]: auth.key } : {} }, opts));
  if (!text(raw.name).trim() || !Array.isArray(raw.skills) || raw.skills.length > 100) throw connectFailure('external_format');
  if (Array.isArray(record(raw.capabilities).extensions) && (record(raw.capabilities).extensions as unknown[]).some((e) => record(e).required === true)) throw connectFailure('external_unsupported');
  const candidates = Array.isArray(raw.supportedInterfaces) ? raw.supportedInterfaces : [
    { url: raw.url, transport: raw.preferredTransport ?? 'JSONRPC', protocolVersion: raw.protocolVersion },
    ...(Array.isArray(raw.additionalInterfaces) ? raw.additionalInterfaces : []),
  ];
  const selected = candidates.map(record).map((i) => ({ url: i.url, transport: i.protocolBinding ?? i.transport, version: text(i.protocolVersion ?? raw.protocolVersion).replace(/^(1\.0|0\.3)(?:\.\d+)?$/, '$1') }))
    .map((i) => a2aInterface.safeParse(i)).find((i) => i.success);
  if (!selected?.success) throw connectFailure('external_unsupported');
  const iface = selected.data;
  await checkedHttpsAddress(iface.url, options.resolve, signal);
  if (new URL(iface.url).search || new URL(iface.url).hash) throw connectFailure('external_safety');
  // Security requirements are OR alternatives of AND schemes. Only header API keys and bearer are supported.
  const schemes = record(raw.securitySchemes);
  const requirements = Array.isArray(raw.securityRequirements) ? raw.securityRequirements : Array.isArray(raw.security) ? raw.security : [];
  if (requirements.length && !requirements.some((r) => Object.keys(record(record(r).schemes ?? r)).length === 0)) {
    let supported = false;
    for (const requirement of requirements) {
      const names = Object.keys(record(record(requirement).schemes ?? requirement));
      if (names.length !== 1) continue;
      const scheme = record(schemes[names[0]!]);
      const api = record(scheme.apiKeySecurityScheme); const http = record(scheme.httpAuthSecurityScheme);
      const type = scheme.type ?? (scheme.apiKeySecurityScheme ? 'apiKey' : scheme.httpAuthSecurityScheme ? 'http' : '');
      const header = text(scheme.name ?? api.name);
      if (type === 'apiKey' && (scheme.in ?? api.location ?? api.in) === 'header' && safeAuthHeader(header)) { iface.headerName = header; iface.authType = 'apiKey'; supported = true; break; }
      if (type === 'http' && text(scheme.scheme ?? http.scheme).toLowerCase() === 'bearer') { iface.headerName = 'Authorization'; iface.authType = 'bearer'; supported = true; break; }
    }
    if (!supported) throw connectFailure('external_unsupported');
  }
  if ((auth.header || auth.key || iface.authType) && new URL(iface.url).origin !== new URL(cardUrl).origin) throw connectFailure('external_safety');
  const card: SafeCard = { name: plainReply(raw.name, auth.key).slice(0, 60), skills: raw.skills.map((s) => { const skill = record(s); return { id: plainReply(skill.id, auth.key).slice(0, 100), name: plainReply(skill.name, auth.key).slice(0, 100) }; }) };
  return { card, iface };
}

/** Nonstreaming bindings from the A2A 1.0 and 0.3 specifications. One deadline includes polling and cancellation. */
export async function sendA2A(ifaceValue: unknown, cardUrl: string, message: string, sessionId: string, auth: { header?: string | null; key?: string }, options: A2ATransport = {}): Promise<string> {
  const parsed = a2aInterface.safeParse(ifaceValue);
  if (!parsed.success) throw connectFailure('external_unsupported');
  const iface = parsed.data;
  if (!safeHttpsUrl(cardUrl)) throw connectFailure('external_safety');
  if ((auth.header || iface.authType) && new URL(iface.url).origin !== new URL(cardUrl).origin) throw connectFailure('external_safety');
  if (iface.authType && !auth.key) throw connectFailure('external_needs_auth');
  const totalMs = options.timeoutMs ?? 10000;
  const signal = AbortSignal.any([AbortSignal.timeout(totalMs), ...(options.signal ? [options.signal] : [])]);
  const workSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, totalMs - Math.min(1000, Math.ceil(totalMs / 5))))]);
  const headers: Record<string, string> = { 'content-type': iface.transport === 'HTTP+JSON' && iface.version === '1.0' ? 'application/a2a+json' : 'application/json', 'A2A-Version': iface.version };
  if (auth.header && auth.key) headers[auth.header] = auth.key;
  const legacy = iface.version === '0.3';
  const invoke = async (operation: 'send' | 'get' | 'cancel', params: Record<string, unknown>) => {
    let url = iface.url; let method = 'POST'; let body: unknown = params;
    if (iface.transport === 'JSONRPC') {
      body = { jsonrpc: '2.0', id: crypto.randomUUID(), method: legacy ? { send: 'message/send', get: 'tasks/get', cancel: 'tasks/cancel' }[operation] : { send: 'SendMessage', get: 'GetTask', cancel: 'CancelTask' }[operation], params };
    } else {
      url = `${iface.url.replace(/\/$/, '')}/${operation === 'send' ? 'message:send' : `tasks/${encodeURIComponent(String(params.id))}${operation === 'cancel' ? ':cancel' : ''}`}`;
      if (operation === 'get') { method = 'GET'; body = undefined; }
      if (operation === 'cancel') body = {};
    }
    const raw = record(await guardedJson(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }, { ...options, signal: operation === 'cancel' ? signal : workSignal }));
    if (raw.error) throw connectFailure('external_unreachable', 502);
    return record(iface.transport === 'JSONRPC' ? raw.result : raw);
  };
  let taskId = ''; let terminal = false;
  try {
    let result = await invoke('send', { message: { ...(legacy ? { kind: 'message' } : {}), messageId: crypto.randomUUID(), ...(options.a2aContexts?.has(sessionId) ? { contextId: options.a2aContexts.get(sessionId) } : {}), role: legacy ? 'user' : 'ROLE_USER', parts: [{ ...(legacy ? { kind: 'text' } : {}), text: message }] }, configuration: { acceptedOutputModes: ['text/plain'], ...(legacy ? { blocking: false } : { returnImmediately: true }) } });
    for (let poll = 0; poll <= 12; poll++) {
      const received = record(result.task ?? result.message ?? result);
      if (typeof received.contextId === 'string' && received.contextId.length <= 200) options.a2aContexts?.set(sessionId, received.contextId);
      const task = record(result.task ?? (result.status ? result : null));
      if (!Object.keys(task).length) return plainReply(partsText(record(result.message ?? result).parts), auth.key);
      const id = text(task.id);
      if (!id || id === '.' || id === '..' || /[\u0000-\u001f\u007f]/.test(id) || id.length > 200 || (taskId && taskId !== id)) throw connectFailure('external_format');
      taskId = id;
      const state = text(record(task.status).state).replace(/^TASK_STATE_/, '').toLowerCase().replace(/_/g, '-');
      terminal = ['completed', 'failed', 'canceled', 'cancelled', 'rejected'].includes(state);
      if (state === 'input-required') throw connectFailure('external_needs_input');
      if (state === 'auth-required') throw connectFailure('external_needs_auth');
      if (state === 'completed') {
        const artifacts = Array.isArray(task.artifacts) ? task.artifacts.map((a) => partsText(record(a).parts)).filter(Boolean).join('\n') : '';
        const history = Array.isArray(task.history) ? task.history.map(record).filter((m) => m.role === 'agent' || m.role === 'ROLE_AGENT').at(-1) : null;
        return plainReply(artifacts || partsText(record(task.status).message && record(record(task.status).message).parts) || partsText(history?.parts), auth.key);
      }
      if (terminal || !['submitted', 'working'].includes(state)) throw connectFailure('external_unreachable', 502);
      if (poll === 12) throw connectFailure('external_timeout', 504);
      // Reserve time for a bounded cancellation rather than polling until the socket deadline.
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(connectFailure('external_timeout', 504)); };
        const timer = setTimeout(() => { workSignal.removeEventListener('abort', abort); resolve(); }, 500);
        if (workSignal.aborted) abort(); else workSignal.addEventListener('abort', abort, { once: true });
      });
      workSignal.throwIfAborted();
      result = await invoke('get', { id: taskId, historyLength: 1 });
    }
    throw connectFailure('external_timeout', 504);
  } catch (error) { if (error instanceof Coded) throw error; throw connectFailure(workSignal.aborted ? 'external_timeout' : 'external_unreachable', 502); } finally {
    if (taskId && !terminal && !signal.aborted) { try { await invoke('cancel', { id: taskId }); } catch { /* safe best effort within the same deadline */ } }
  }
}
function partsText(parts: unknown): string { return Array.isArray(parts) ? parts.map((p) => text(record(p).text)).filter(Boolean).join('\n') : ''; }
