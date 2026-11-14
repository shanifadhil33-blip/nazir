import 'server-only';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { TransactionDriver } from '../db/driver';
import { Coded } from '../http/errors';
import { keyHash, keyPattern } from './keys';
import { redactText, secretName } from './redact';

const KINDS = ['invoke_agent', 'execute_tool', 'chat', 'nazir.action', 'nazir.turn.end', 'nazir.hello', 'nazir.blocked'] as const;
export const MAX_TRACE_BYTES = 65536;
export const MAX_INVENTORY_BYTES = 262144;
const MAX_VALUE = 8192;
const id = z.string().regex(/^[0-9A-Za-z_-]{1,64}$/);
const time = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v))).optional().nullable();
const span = z.object({
  trace_id: id.optional().nullable(), span_id: id.optional().nullable(), parent_span_id: id.optional().nullable(),
  name: z.string().min(1).max(200), kind: z.enum(KINDS).optional(),
  start: time, end: time,
  status: z.union([z.object({ code: z.string().max(10) }).passthrough(), z.string().max(10)]).optional(),
  attributes: z.record(z.string().max(200), z.unknown()).optional(),
  turn: z.number().int().min(0).max(100).optional(),
});
const traceBody = z.object({
  sdk: z.object({ name: z.string().max(40), version: z.string().max(40) }).passthrough(),
  agent: z.object({ name: z.string().max(200).optional(), version: z.string().max(40).optional() }).passthrough().optional(),
  session: z.string().regex(/^ses_[0-9a-f]{32}$/),
  turn: z.number().int().min(0).max(100),
  spans: z.array(span).min(1).max(100),
});
type Span = z.infer<typeof span>;

export function bearerKey(header: string | null) {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  const key = match?.[1] ?? '';
  if (!keyPattern.test(key)) throw new Coded(401, 'sdk_key', 'This Nazir key is not valid or was turned off.');
  return key;
}
function kindOf(item: Span): (typeof KINDS)[number] | null {
  if (item.kind) return item.kind;
  if ((KINDS as readonly string[]).includes(item.name)) return item.name as (typeof KINDS)[number];
  const op = String(item.attributes?.['gen_ai.operation.name'] ?? '');
  return (KINDS as readonly string[]).includes(op) ? op as (typeof KINDS)[number] : null;
}
/** Flat values only. Secret named fields are dropped. Long values are cut and marked. Personal data is masked. */
export function cleanAttributes(attributes: Record<string, unknown> = {}, keep: readonly string[] = []) {
  const out: Record<string, string | number | boolean | null> = {};
  let truncated = false;
  for (const [name, raw] of Object.entries(attributes).slice(0, 64)) {
    if (secretName.test(name)) continue;
    let value: string | number | boolean | null;
    if (raw === null || typeof raw === 'boolean' || (typeof raw === 'number' && Number.isFinite(raw))) value = raw as never;
    else value = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? '';
    if (typeof value === 'string') {
      if (value.length > MAX_VALUE) { value = value.slice(0, MAX_VALUE); truncated = true; }
      value = redactText(value, keep);
    }
    out[name] = value;
  }
  if (truncated) out['nazir.truncated'] = true;
  return out;
}

export function prepareSpans(raw: unknown) {
  const body = traceBody.parse(raw);
  const spans = body.spans.flatMap((item) => {
    const kind = kindOf(item);
    if (!kind) return [];
    const status = typeof item.status === 'string' ? item.status : item.status?.code;
    return [{ trace_id: item.trace_id ?? null, span_id: item.span_id ?? null, parent_span_id: item.parent_span_id ?? null, kind, name: item.name,
      start: item.start ?? null, end: item.end ?? null, status: status === 'ERROR' ? 'ERROR' : status === 'UNSET' ? 'UNSET' : 'OK',
      turn: item.turn ?? body.turn, attributes: cleanAttributes(item.attributes) }];
  });
  if (!spans.length) throw new Coded(400, 'validation', 'Check the details and try again.');
  return { session: body.session, version: body.sdk.version, spans };
}

const recent = new Map<string, number[]>();
/** Ten requests a second per key in this process. The database also caps spans per session and per hour. */
export function allowKey(hash: string, now = Date.now()) {
  const list = (recent.get(hash) ?? []).filter((t) => now - t < 1000);
  if (list.length >= 10) return false;
  list.push(now); if (recent.size > 5000) recent.clear(); recent.set(hash, list);
  return true;
}
async function call<T extends Record<string, unknown>>(driver: TransactionDriver, sql: string, params: unknown[]) {
  try {
    return await driver.transaction(async (db) => { await db.query('SET LOCAL ROLE nazir_ingest'); return (await db.query<T>(sql, params)).rows; });
  } catch (error) {
    const message = String((error as Error)?.message);
    for (const code of ['sdk_key', 'sdk_session', 'sdk_limit'] as const) if (message.includes(code)) throw new Coded(code === 'sdk_key' ? 401 : code === 'sdk_session' ? 403 : 429, code, code);
    throw error;
  }
}
async function readBody(request: Request, max: number) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > max) throw new Coded(413, 'sdk_too_big', 'The request is too large.');
  const text = await request.text();
  if (Buffer.byteLength(text) > max) throw new Coded(413, 'sdk_too_big', 'The request is too large.');
  try { return JSON.parse(text) as unknown; } catch { throw new Coded(400, 'validation', 'Check the details and try again.'); }
}
export async function ingestTraces(driver: TransactionDriver, request: Request) {
  const hash = keyHash(bearerKey(request.headers.get('authorization')));
  if (!allowKey(hash)) throw new Coded(429, 'sdk_limit', 'Too much was sent.');
  const prepared = prepareSpans(await readBody(request, MAX_TRACE_BYTES));
  const rows = await call<{ n: number }>(driver, 'SELECT nazir.ingest_spans($1,$2,$3::jsonb,$4) AS n', [hash, prepared.session, JSON.stringify(prepared.spans), prepared.version]);
  return { accepted: rows[0]?.n ?? 0 };
}

const inventoryBody = z.object({ sdk: z.object({ version: z.string().max(40) }).passthrough(), agent: z.unknown().optional(), inventory: z.record(z.string(), z.unknown()) });
/** Removes secret named fields at every depth and keeps only the shapes the agent map reads. */
export function cleanInventory(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => cleanInventory(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !secretName.test(k) && k !== 'instructions').slice(0, 100).map(([k, v]) => [k.slice(0, 100), cleanInventory(v, depth + 1)]));
  if (typeof value === 'string') return redactText(value.slice(0, 2000).replace(/\/\/[^/@\s]*@/g, '//').replace(/\?.*$/, ''));
  return typeof value === 'number' || typeof value === 'boolean' || value === null ? value : null;
}
export async function ingestInventory(driver: TransactionDriver, request: Request) {
  const hash = keyHash(bearerKey(request.headers.get('authorization')));
  if (!allowKey(hash)) throw new Coded(429, 'sdk_limit', 'Too much was sent.');
  const body = inventoryBody.parse(await readBody(request, MAX_INVENTORY_BYTES));
  const inventory = cleanInventory(body.inventory) as Record<string, unknown>;
  const text = JSON.stringify(inventory);
  const rows = await call<{ changed: boolean }>(driver, 'SELECT nazir.ingest_inventory($1,$2,$3::jsonb) AS changed', [hash, createHash('sha256').update(text).digest('hex'), text]);
  return { changed: rows[0]?.changed ?? false };
}
