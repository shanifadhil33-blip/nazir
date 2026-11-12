import 'server-only';
import { Coded, errorLines } from '../http/errors';
import { checkedHttpsAddress, pinnedHttpsFetch, pinnedLookup, type PinnedRequestInit, type Resolver } from '../settings/net-guard';

export const connectFailure = (code: keyof typeof errorLines, status = 400) => new Coded(status, code, errorLines[code].en);
export type Transport = { fetcher?: (url: string, init: PinnedRequestInit) => Promise<Response>; resolve?: Resolver; timeoutMs?: number; signal?: AbortSignal };

/** Every hop resolves and pins its own public address. Bodies, redirects and errors stay bounded. */
export async function guardedJson(url: string, init: RequestInit, options: Transport = {}): Promise<unknown> {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 10000), ...(options.signal ? [options.signal] : [])]);
  const work = async () => {
    const address = await checkedHttpsAddress(url, options.resolve);
    signal.throwIfAborted();
    const response = await (options.fetcher ?? pinnedHttpsFetch)(url, { ...init, redirect: 'manual', signal, lookup: pinnedLookup(address), servername: new URL(url).hostname, rejectUnauthorized: true });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw connectFailure('external_safety'); }
    if (!response.ok) { await response.body?.cancel(); throw connectFailure(response.status === 401 || response.status === 403 ? 'external_needs_auth' : 'external_unreachable', 502); }
    if (Number(response.headers.get('content-length')) > 65536) { await response.body?.cancel(); throw connectFailure('external_format', 502); }
    const reader = response.body?.getReader();
    if (!reader) throw connectFailure('external_format', 502);
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) throw connectFailure('external_format', 502);
        chunks.push(value);
      }
    } finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw connectFailure('external_format', 502); }
  };
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      abort = () => reject(connectFailure('external_timeout', 504));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    })]);
  } catch (error) { if (error instanceof Coded) throw error; throw connectFailure(signal.aborted ? 'external_timeout' : 'external_unreachable', 502); }
  finally { if (abort) signal.removeEventListener('abort', abort); }
}

export function plainReply(value: unknown, key?: string): string {
  if (typeof value !== 'string' || !value.trim()) throw connectFailure('external_format', 502);
  const redact = (text: string) => key ? text.split(key).join('[redacted]').split(key.replace(/^Bearer /i, '')).join('[redacted]') : text;
  const plain = redact(redact(value).replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()).slice(0, 8000);
  if (!plain) throw connectFailure('external_format', 502);
  return plain;
}
