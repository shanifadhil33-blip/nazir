import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { safeHttpsUrl } from './agent-settings';

// 198.18.0.0/15 is the benchmark range; a fake IP DNS proxy (the build box) answers from it. Only scripts on such a box set
// NAZIR_ALLOW_BENCHMARK_DNS=1; production never does.
export function privateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 198 && b === 51) || (a === 203 && b === 0) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19) && process.env.NAZIR_ALLOW_BENCHMARK_DNS !== '1') || a >= 224;
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
