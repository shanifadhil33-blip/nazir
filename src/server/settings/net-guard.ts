import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { safeHttpsUrl } from './agent-settings';

export function privateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = address.toLowerCase();
    if (x === '::' || x === '::1') return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateAddress(mapped[1]!);
    return /^(?:fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

export type Resolver = (host: string) => Promise<{ address: string }[]>;
const defaultResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

/** https, not a private literal, and every address the name resolves to is public. Checked at save and again before each call. */
export async function publicHttpsUrl(value: string, resolve: Resolver = defaultResolver): Promise<boolean> {
  if (!safeHttpsUrl(value)) return false;
  try {
    const addresses = await resolve(new URL(value).hostname);
    return addresses.length > 0 && addresses.every((a) => !privateAddress(a.address));
  } catch {
    return false;
  }
}
