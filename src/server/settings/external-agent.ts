import 'server-only';
import { z } from 'zod';
import type { TransactionDriver } from '../db/driver';
import { withMember, withWorker } from '../db/context';
import { Coded, Forbidden, NotFound, errorLines } from '../http/errors';
import { openKey, sealKey, safeHttpsUrl } from './agent-settings';
import { publicHttpsUrl, type Resolver } from './net-guard';

export type ExternalView = { name: string; host: string; ready: boolean; endpoint?: string; format?: 'openai_chat' | 'simple_json'; header_name?: string | null; key_saved?: boolean; key_last4?: string | null };
export type ExternalRow = { revision: string; endpoint: string; format: 'openai_chat' | 'simple_json'; header_name: string | null; key_cipher: string | null; tested_at: string | null };
export const externalInput = z.object({
  name: z.string().trim().min(1).max(60),
  endpoint: z.string().trim().max(2000).refine(safeHttpsUrl),
  format: z.enum(['openai_chat', 'simple_json']),
  header_name: z.string().trim().max(100).regex(/^[A-Za-z][A-Za-z0-9_-]*$/).refine((v) => !/^(host|content-type|content-length|connection|transfer-encoding|cookie|proxy-.*|sec-.*|accept-encoding)$/i.test(v)).optional(),
  secret: z.string().min(8).max(400).regex(/^[\x20-\x7e]+$/).optional(),
}).strict().refine((v) => !v.secret || !!v.header_name);
const failure = (code: keyof typeof errorLines, status = 400) => new Coded(status, code, errorLines[code].en);
async function member<T>(driver: TransactionDriver, id: string, fn: Parameters<typeof withMember<T>>[2]) {
  try { return await withMember(driver, id, fn); }
  catch (e) {
    if (/cannot do this/.test(String((e as Error)?.message))) throw new Forbidden();
    if (/external_rate_limit/.test(String((e as Error)?.message))) throw failure('external_rate_limit', 429);
    throw e;
  }
}
export function readExternalAgent(driver: TransactionDriver, id: string): Promise<ExternalView | null> {
  return member(driver, id, async (db) => (await db.query<{ s: ExternalView | null }>('SELECT nazir.read_external_agent() AS s')).rows[0]!.s);
}
export async function saveExternalAgent(driver: TransactionDriver, id: string, value: unknown, secret?: string, resolve?: Resolver) {
  // Authorize before DNS or parsing a submitted secret.
  const settings = await member(driver, id, async (db) => (await db.query<{ ok: boolean }>("SELECT nazir.member_has_role('service_owner') AS ok")).rows[0]!.ok);
  if (!settings) throw new Forbidden();
  const input = externalInput.parse(value);
  if (!await publicHttpsUrl(input.endpoint, resolve)) throw failure('external_safety');
  const { secret: key, ...payload } = input;
  await member(driver, id, (db) => db.query('SELECT nazir.save_external_agent($1::jsonb,$2,$3)', [JSON.stringify(payload), key ? sealKey(key, secret) : null, key?.slice(-4) ?? null]));
  return readExternalAgent(driver, id);
}
export async function removeExternalAgent(driver: TransactionDriver, id: string) {
  await member(driver, id, (db) => db.query('SELECT nazir.remove_external_agent()'));
  return { removed: true };
}
export function externalAgentForWorker(driver: TransactionDriver, workspaceId: string) {
  return withWorker(driver, workspaceId, async (db) => (await db.query<ExternalRow>('SELECT * FROM nazir.external_agent_worker()')).rows[0] ?? null);
}
export type ExternalMessage = { role: 'user' | 'assistant'; content: string };
export type ExternalTransport = { fetcher?: typeof fetch; resolve?: Resolver; secret?: string; timeoutMs?: number };
/** The only outbound path. Never include transport errors, response bodies, or credentials in errors. */
export async function callExternalAgent(row: ExternalRow, messages: ExternalMessage[], sessionId: string, language: 'en' | 'ar', options: ExternalTransport = {}): Promise<string> {
  const controller = new AbortController();
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(failure('external_timeout', 504)), { once: true });
  });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  const request = async () => {
    if (!await publicHttpsUrl(row.endpoint, options.resolve)) throw failure('external_safety');
    controller.signal.throwIfAborted();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    let key: string | undefined;
    if (row.header_name && row.key_cipher) {
      try { key = openKey(row.key_cipher, options.secret); headers[row.header_name] = key; }
      catch { throw failure('external_unreachable', 502); }
    }
    const body = row.format === 'openai_chat' ? { messages } : { message: messages.at(-1)?.content ?? '', session_id: sessionId, language };
    const response = await (options.fetcher ?? fetch)(row.endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw failure('external_safety'); }
    if (!response.ok) { await response.body?.cancel(); throw failure('external_unreachable', 502); }
    if (Number(response.headers.get('content-length')) > 65536) { await response.body?.cancel(); throw failure('external_format', 502); }
    const reader = response.body?.getReader();
    if (!reader) throw failure('external_format', 502);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) throw failure('external_format', 502);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('external_format', 502); }
    const reply = row.format === 'openai_chat' ? parsed?.choices?.[0]?.message?.content : parsed?.reply;
    if (typeof reply !== 'string' || !reply.trim()) throw failure('external_format', 502);
    // Prevent an endpoint that echoes its auth header from sending the secret into saved evidence or a judge.
    const redacted = key ? reply.split(key).join('[redacted]') : reply;
    const plain = redacted.replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 8000);
    if (!plain) throw failure('external_format', 502);
    return plain;
  };
  try { return await Promise.race([request(), timeout]); }
  catch (e) { if (e instanceof Coded) throw e; throw failure(controller.signal.aborted ? 'external_timeout' : 'external_unreachable', 502); }
  finally { clearTimeout(timer); controller.abort(); }
}
export async function testExternalAgent(driver: TransactionDriver, id: string, value: unknown, options: ExternalTransport = {}) {
  const row = await member(driver, id, async (db) => (await db.query<ExternalRow>('SELECT * FROM nazir.external_agent_test_secret()')).rows[0]);
  if (!row) throw new NotFound();
  const input = z.object({ message: z.string().trim().min(1).max(1000), language: z.enum(['en', 'ar']) }).strict().parse(value);
  const reply = await callExternalAgent(row, [{ role: 'user', content: input.message }], crypto.randomUUID(), input.language, options);
  const ready = await member(driver, id, async (db) => (await db.query<{ ok: boolean }>('SELECT nazir.external_agent_tested($1) AS ok', [row.revision])).rows[0]!.ok);
  if (!ready) throw failure('external_changed', 409);
  return { reply, ready };
}
