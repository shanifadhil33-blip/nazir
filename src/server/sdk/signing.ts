import 'server-only';
import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify, type KeyObject } from 'node:crypto';

/** One Ed25519 key, derived from the deployment's auth secret. Only Nazir can sign; anyone can verify. */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export type TestMode = 'quality' | 'security' | 'connect';
type Keys = { privateKey: KeyObject; publicRaw: Buffer; kid: string };
let cached: { secret: string; keys: Keys } | null = null;

export function signingKeys(secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? ''): Keys | null {
  if (secret.length < 16) return null;
  if (cached?.secret === secret) return cached.keys;
  const seed = Buffer.from(hkdfSync('sha256', secret, 'nazir', 'test-session-signing-v1', 32));
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const publicRaw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length);
  const keys = { privateKey, publicRaw: Buffer.from(publicRaw), kid: createHash('sha256').update(publicRaw).digest('hex').slice(0, 16) };
  cached = { secret, keys };
  return keys;
}

export const workspacePublicId = (workspaceId: string) => workspaceId.replace(/-/g, '').toLowerCase();
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export function signedPayload(t: number, ws: string, session: string, turn: number, mode: TestMode, inject = '') {
  return `${t}.${ws}.${session}.${turn}.${mode}.${sha(inject)}`;
}

/** Headers for one test turn. A2A also carries them in message metadata. Never logged. */
export function testHeaders(input: { workspaceId: string; session: string; turn: number; mode: TestMode; inject?: string; now?: number }, keys = signingKeys()): Record<string, string> {
  const headers: Record<string, string> = { 'X-Nazir-Session': input.session, 'X-Nazir-Turn': String(input.turn), 'X-Nazir-Mode': input.mode };
  const trace = sha(input.session).slice(0, 32);
  const span = sha(`${input.session}:${input.turn}`).slice(0, 16);
  headers.traceparent = `00-${trace}-${span}-01`;
  if (!keys) return headers;
  const t = Math.floor((input.now ?? Date.now()) / 1000);
  const ws = workspacePublicId(input.workspaceId);
  const sig = sign(null, Buffer.from(signedPayload(t, ws, input.session, input.turn, input.mode, input.inject ?? '')), keys.privateKey).toString('base64url');
  headers['X-Nazir-Signature'] = `t=${t},ws=${ws},kid=${keys.kid},sig=${sig}`;
  if (input.inject) headers['X-Nazir-Inject'] = Buffer.from(input.inject).toString('base64');
  return headers;
}

/** Server side mirror of the SDK check, for tests and the sample agent. */
export function verifyTestHeaders(headers: Record<string, string | undefined>, publicRaw: Buffer, now = Date.now()) {
  const signature = headers['x-nazir-signature'] ?? headers['X-Nazir-Signature'];
  const session = headers['x-nazir-session'] ?? headers['X-Nazir-Session'];
  const turn = Number(headers['x-nazir-turn'] ?? headers['X-Nazir-Turn']);
  const mode = (headers['x-nazir-mode'] ?? headers['X-Nazir-Mode']) as TestMode;
  if (!signature || !session || !Number.isInteger(turn)) return null;
  const parts = Object.fromEntries(signature.split(',').map((part) => { const i = part.indexOf('='); return [part.slice(0, i), part.slice(i + 1)]; }));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(now / 1000 - t) > 300 || !parts.ws || !parts.sig) return null;
  const injectRaw = headers['x-nazir-inject'] ?? headers['X-Nazir-Inject'];
  const inject = injectRaw ? Buffer.from(injectRaw, 'base64').toString('utf8') : '';
  const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicRaw]), format: 'der', type: 'spki' });
  const ok = verify(null, Buffer.from(signedPayload(t, parts.ws, session, turn, mode, inject)), key, Buffer.from(parts.sig, 'base64url'));
  return ok ? { ws: parts.ws, session, turn, mode, inject } : null;
}

export function publicKeySet(keys = signingKeys()) {
  return { keys: keys ? [{ kid: keys.kid, alg: 'Ed25519', use: 'sig', public_key: keys.publicRaw.toString('base64url') }] : [] };
}
