import 'server-only';
import { z } from 'zod';
import type { TransactionDriver } from '../db/driver';
import { withMember, withWorker } from '../db/context';
import { Coded, Forbidden, NotFound, errorLines } from '../http/errors';
import { openKey, sealKey } from './agent-settings';
import { checkedHttpsAddress, privateUrlHost, safeHttpsUrl, type Resolver } from './net-guard';
import { discoverA2A, sendA2A, safeAuthHeader, type A2AInterface, type A2ATransport, type SafeCard } from '../connect/a2a';
import { guardedJson, plainReply, type Transport } from '../connect/http';
import { testHeaders, type TestMode } from '../sdk/signing';

export type ConnectionFormat = 'openai_chat' | 'simple_json' | 'a2a';
export type ExternalView = { name: string; host: string; ready: boolean; revision?: string; endpoint?: string; format?: ConnectionFormat; connection_kind?: 'api' | 'sdk'; tested_at?: string | null; card_url?: string | null; card?: SafeCard | null; a2a_interface?: A2AInterface | null; header_name?: string | null; key_saved?: boolean; key_last4?: string | null };
export type ExternalRow = { name?: string; revision: string; endpoint: string; format: ConnectionFormat; card_url?: string | null; card?: SafeCard | null; a2a_interface?: A2AInterface | null; connection_kind?: 'api' | 'sdk'; header_name: string | null; key_cipher: string | null; tested_at: string | null };
export const externalInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  endpoint: z.string().trim().max(2000).refine(safeHttpsUrl, { error: (issue) => privateUrlHost(String(issue.input)) ? 'external_private_address' : 'external_safety' }),
  format: z.enum(['openai_chat', 'simple_json', 'a2a']),
  header_name: z.string().trim().max(100).regex(/^[A-Za-z][A-Za-z0-9_-]*$/).refine(safeAuthHeader).optional(),
  secret: z.string().min(8).max(400).regex(/^[\x20-\x7e]+$/).optional(),
}).strict().refine((v) => !v.secret || !!v.header_name);
const failure = (code: keyof typeof errorLines, status = 400) => new Coded(status, code, errorLines[code].en);
async function member<T>(driver: TransactionDriver, id: string, fn: Parameters<typeof withMember<T>>[2]) {
  try { return await withMember(driver, id, fn); }
  catch (e) {
    if (/cannot do this|demo_connection/.test(String((e as Error)?.message))) throw new Forbidden();
    if (/external_rate_limit/.test(String((e as Error)?.message))) throw failure('external_rate_limit', 429);
    throw e;
  }
}
export function readExternalAgent(driver: TransactionDriver, id: string): Promise<ExternalView | null> {
  return member(driver, id, async (db) => (await db.query<{ s: ExternalView | null }>('SELECT nazir.read_external_agent() AS s')).rows[0]!.s);
}
export async function saveExternalAgent(driver: TransactionDriver, id: string, value: unknown, secret?: string, resolve?: Resolver, transport: Transport = {}) {
  await assertConnectionWrite(driver, id);
  const input = externalInput.parse(value);
  if (input.format !== 'a2a') await checkedHttpsAddress(input.endpoint, resolve, AbortSignal.timeout(10000));
  const { secret: key, ...fields } = input;
  const existing = await readExternalAgent(driver, id);
  // A saved credential may be kept only on the same address and header. Never move it to a new host.
  const keepKey = (existing?.card_url ?? existing?.endpoint) === input.endpoint && existing?.header_name === input.header_name;
  let discoveryKey = key;
  if (input.format === 'a2a' && !key && keepKey && existing?.key_saved) {
    const saved = await member(driver, id, async (db) => (await db.query<ExternalRow>('SELECT * FROM nazir.external_agent_test_secret()')).rows[0]);
    if (!saved || saved.revision !== existing.revision || (saved.card_url ?? saved.endpoint) !== input.endpoint || saved.header_name !== input.header_name) throw failure('external_changed', 409);
    if (saved.key_cipher) { try { discoveryKey = openKey(saved.key_cipher, secret); } catch { throw failure('external_unreachable', 502); } }
  }
  const discovery = input.format === 'a2a' ? await discoverA2A(input.endpoint, { header: input.header_name, key: discoveryKey }, { ...transport, resolve }) : null;
  if (discovery && existing?.key_saved && !key && keepKey && new URL(discovery.iface.url).origin !== new URL(input.endpoint).origin) throw failure('external_safety');
  const header = discovery?.iface.headerName ?? input.header_name;
  if (key && discovery?.iface.authType === 'bearer' && !/^Bearer /i.test(key)) throw failure('validation');
  const payload = { ...fields, name: discovery?.card.name ?? input.name ?? new URL(input.endpoint).hostname.slice(0, 60), connection_kind: 'api',
    header_name: header, keep_key: keepKey && header === input.header_name,
    ...(discovery ? { endpoint: discovery.iface.url, card_url: input.endpoint, card: discovery.card, card_fetched_at: new Date().toISOString(), a2a_interface: discovery.iface } : {}) };
  await member(driver, id, (db) => db.query('SELECT nazir.save_external_agent($1::jsonb,$2,$3)', [JSON.stringify(payload), key ? sealKey(key, secret) : null, key?.slice(-4) ?? null]));
  return readExternalAgent(driver, id);
}
export async function removeExternalAgent(driver: TransactionDriver, id: string) {
  await assertConnectionWrite(driver, id);
  await member(driver, id, (db) => db.query('SELECT nazir.remove_external_agent()'));
  return { removed: true };
}
export function externalAgentForWorker(driver: TransactionDriver, workspaceId: string) {
  return withWorker(driver, workspaceId, async (db) => (await db.query<ExternalRow>('SELECT * FROM nazir.external_agent_worker()')).rows[0] ?? null);
}
export type ExternalMessage = { role: 'user' | 'assistant'; content: string };
export type ExternalTransport = A2ATransport & { secret?: string; sdkWaitMs?: number; test?: { workspaceId: string; session: string; turn: number; mode: TestMode; inject?: string } };
/** The shared adapter keeps secrets and raw transport errors out of saved replies. */
export async function callExternalAgent(row: ExternalRow, messages: ExternalMessage[], sessionId: string, language: 'en' | 'ar', options: ExternalTransport = {}): Promise<string> {
  let key: string | undefined;
  if (row.header_name && !safeAuthHeader(row.header_name)) throw failure('external_safety');
  try { if (row.header_name && row.key_cipher) key = openKey(row.key_cipher, options.secret); }
  catch { throw failure('external_unreachable', 502); }
  // Every adapter carries the signed test headers. Without the SDK the agent simply ignores them.
  const signed = options.test ? testHeaders(options.test) : {};
  if (row.format === 'a2a') return sendA2A(row.a2a_interface, row.card_url ?? row.endpoint, messages.at(-1)?.content ?? '', options.test?.session ?? sessionId, { header: row.header_name, key }, { ...options, testHeaders: signed });
  const headers: Record<string, string> = { ...signed, 'content-type': 'application/json' };
  if (row.header_name && key) headers[row.header_name] = key;
  const body = row.format === 'openai_chat' ? { messages } : { message: messages.at(-1)?.content ?? '', session_id: options.test?.session ?? sessionId, language };
  const parsed = await guardedJson(row.endpoint, { method: 'POST', headers, body: JSON.stringify(body) }, options) as { choices?: { message?: { content?: unknown } }[]; reply?: unknown } | null;
  return plainReply(row.format === 'openai_chat' ? parsed?.choices?.[0]?.message?.content : parsed?.reply, key);
}
/** Trusted database context, including legacy callers. Runs before DNS, key parsing or outbound calls. */
async function assertConnectionWrite(driver: TransactionDriver, id: string) {
  const allowed = await member(driver, id, async (db) => (await db.query<{ ok: boolean }>("SELECT nazir.member_has_role('service_owner') AND EXISTS(SELECT 1 FROM nazir.workspaces WHERE id=nazir.current_workspace_id() AND kind='real') AS ok")).rows[0]?.ok);
  if (!allowed) throw new Forbidden();
}
export async function testExternalAgent(driver: TransactionDriver, id: string, value: unknown, options: ExternalTransport = {}) {
  await assertConnectionWrite(driver, id);
  const row = await member(driver, id, async (db) => (await db.query<ExternalRow>('SELECT * FROM nazir.external_agent_test_secret()')).rows[0]);
  if (!row) throw new NotFound();
  const input = z.object({ message: z.string().trim().min(1).max(1000), language: z.enum(['en', 'ar']), revision: z.uuid().optional() }).strict().parse(value);
  if (input.revision && input.revision !== row.revision) throw failure('external_changed', 409);
  const opened = await member(driver, id, async (db) => (await db.query<{ session: string; workspace: string; key: string | null }>("SELECT nazir.open_test_session('connect') AS session, nazir.current_workspace_id() AS workspace, nazir.read_sdk_status()->>'key_last4' AS key")).rows[0]!);
  const reply = await callExternalAgent(row, [{ role: 'user', content: input.message }], opened.session, input.language, { ...options, test: { workspaceId: opened.workspace, session: opened.session, turn: 1, mode: 'connect' } });
  const ready = await member(driver, id, async (db) => (await db.query<{ ok: boolean }>('SELECT nazir.external_agent_tested($1) AS ok', [row.revision])).rows[0]!.ok);
  if (!ready) throw failure('external_changed', 409);
  // With a key made, wait briefly for the SDK to report this turn. Without one, the test is replies only.
  const sdk = opened.key ? await waitForTurn(driver, id, opened.session, 1, options.sdkWaitMs ?? 4000) : null;
  return { reply, ready, sdk };
}

export type TurnTrace = { seen: boolean; hello: boolean; toolCalls: number; spans: { kind: string; name: string; status: string; attributes: Record<string, unknown> }[] };
/** Reads what the SDK reported for one test turn. Waits until its turn end arrives or the time is up. */
export async function waitForTurn(driver: TransactionDriver, memberId: string, session: string, turn: number, waitMs = 4000, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<TurnTrace> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const spans = await member(driver, memberId, async (db) => (await db.query<{ kind: string; name: string; status: string; attributes: Record<string, unknown> }>('SELECT kind,name,status,attributes FROM nazir.trace_spans WHERE session_id=$1 AND turn=$2 ORDER BY id', [session, turn])).rows);
    const ended = spans.some((s) => s.kind === 'nazir.turn.end');
    if (ended || Date.now() >= deadline) return { seen: spans.length > 0, hello: spans.some((s) => s.kind === 'nazir.hello'), toolCalls: spans.filter((s) => s.kind === 'execute_tool' || s.kind === 'nazir.blocked').length, spans };
    await sleep(250);
  }
}
