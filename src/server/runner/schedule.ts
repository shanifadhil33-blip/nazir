import 'server-only';
import { after } from 'next/server';

/** Only deployment configuration chooses the destination. Never forward a secret to a request Host header. */
export function runnerUrl(env: Record<string, string | undefined> = process.env): URL | null {
  const productionUrl = env.VERCEL_PROJECT_PRODUCTION_URL;
  const configured = env.AUTH_URL
    || (productionUrl ? (productionUrl.includes('://') ? productionUrl : `https://${productionUrl}`) : null)
    || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null)
    || (env.NODE_ENV === 'development' ? 'http://localhost:3000' : null);
  if (!configured) return null;
  const url = new URL('/api/runner/tick', configured);
  if (url.username || url.password || (url.protocol !== 'https:' && !(env.NODE_ENV === 'development' && url.hostname === 'localhost'))) return null;
  return url;
}

/** Register after the enqueue transaction commits, before returning Start's response.
 * The tick responds immediately and owns its work with after(), so closing the phone cannot stop it. */
export function scheduleRunner() {
  const secret = process.env.CRON_SECRET;
  const url = runnerUrl();
  if (!secret || !url) return false;
  after(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
        if (response.ok) return;
      } catch { /* Retry without logging headers, URLs or response bodies. */ }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  });
  return true;
}
