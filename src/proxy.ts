import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Every change a signed in person makes goes through /api/workspaces with a session cookie.
 * A browser that sends one of these from another site is refused, even though the cookie is SameSite Lax.
 * Requests with no Origin and no Sec-Fetch-Site (scripts, tests, servers) pass, because they carry no browser cookie.
 */
export function sameOrigin(method: string, host: string | null, origin: string | null, fetchSite: string | null): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  if (!origin) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

export function proxy(request: NextRequest) {
  const ok = sameOrigin(request.method, request.headers.get('host'), request.headers.get('origin'), request.headers.get('sec-fetch-site'));
  if (ok) return NextResponse.next();
  return NextResponse.json({ error: { code: 'forbidden', message: 'This request did not come from the app.' } }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
}

export const config = { matcher: ['/api/workspaces', '/api/workspaces/:path*'] };
