import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { Coded, errorLines } from '../http/errors';

// 198.18.0.0/15 is the benchmark range; a fake IP DNS proxy (the build box) answers from it. Only scripts on such a box set
// NAZIR_ALLOW_BENCHMARK_DNS=1; production never does. Checked connections always pass false and require public IPs.
export function privateAddress(address: string, allowBenchmarkDns = process.env.NAZIR_ALLOW_BENCHMARK_DNS === '1'): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 198 && b === 51) || (a === 203 && b === 0) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19) && !allowBenchmarkDns) || a >= 224;
  }
  if (v === 6) {
    // Accept only global unicast. This also refuses mapped IPv4 (including hex forms),
    // translation prefixes, unique local, multicast and link local addresses.
    const [firstText, secondText = '0'] = address.split(':');
    const first = parseInt(firstText!, 16), second = parseInt(secondText || '0', 16);
    if ((first & 0xe000) !== 0x2000) return true;
    // Transition, protocol assignment and documentation ranges are not public endpoints.
    return first === 0x2002 || (first === 0x2001 && (second < 0x200 || second === 0xdb8)) || (first === 0x3fff && second < 0x1000);
  }
  return true;
}

export type Resolver = (host: string) => Promise<{ address: string }[]>;
const defaultResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

/** A local hostname or non public literal, without performing DNS. */
export function privateUrlHost(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (!host.includes('.') && !host.includes(':')) || (isIP(host) !== 0 && privateAddress(host, false));
  } catch { return false; }
}

/** Resolve exactly once and validate every answer before selecting a socket address. */
export async function checkedHttpsAddress(value: string, resolve: Resolver = defaultResolver): Promise<string> {
  const fail = (code: 'external_safety' | 'external_private_address'): never => { throw new Coded(400, code, errorLines[code].en); };
  if (privateUrlHost(value)) return fail('external_private_address');
  if (!safeHttpsUrl(value)) return fail('external_safety');
  const host = new URL(value).hostname;
  let addresses: { address: string }[];
  try { addresses = isIP(host) ? [{ address: host }] : await resolve(host); }
  catch { return fail('external_safety'); }
  if (!addresses.length) return fail('external_safety');
  if (addresses.some((a) => privateAddress(a.address, false))) return fail('external_private_address');
  return addresses[0]!.address;
}

export async function publicHttpsUrl(value: string, resolve: Resolver = defaultResolver): Promise<boolean> {
  try { await checkedHttpsAddress(value, resolve); return true; } catch { return false; }
}

export type PinnedRequestInit = RequestInit & { lookup: LookupFunction; servername: string; rejectUnauthorized: true };
/** No DNS in this lookup. Repeated socket attempts always use the checked address. */
export function pinnedLookup(address: string): LookupFunction {
  return (_host, options, callback) => {
    const family = isIP(address);
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/** Native HTTPS keeps Host and certificate identity from the original URL. No redirects or proxy environment lookup. */
export function pinnedHttpsFetch(value: string, init: PinnedRequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(value, {
      method: init.method, headers: init.headers as Record<string, string>, signal: init.signal ?? undefined,
      agent: false, lookup: init.lookup, servername: init.servername, rejectUnauthorized: true,
    }, (res) => {
      const headers = new Headers();
      for (const [name, values] of Object.entries(res.headers)) {
        for (const v of Array.isArray(values) ? values : values === undefined ? [] : [String(values)]) headers.append(name, v);
      }
      try {
        const noBody = [204, 205, 304].includes(res.statusCode ?? 0);
        if (noBody) res.resume();
        resolve(new Response(noBody ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status: res.statusCode, headers }));
      } catch (error) { res.destroy(); reject(error); }
    });
    req.on('error', reject);
    req.end(init.body as string);
  });
}

/** Only public https hosts; refuses loopback, private and link local literals so the server cannot be pointed inward. */
export function safeHttpsUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port !== '' && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !host.includes(':')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (host.includes(':')) return false; // IPv6 literals are refused outright.
  return true;
}
