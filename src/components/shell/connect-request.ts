import type { Lang } from '@/components/ocean/copy';

/** Saving alone never establishes readiness. Always test the newly saved revision. */
export async function saveAndTestConnection(workspaceId: string, lang: Lang, connection: Record<string, unknown>, message: string, fetcher: typeof fetch = fetch) {
  const url = `/api/workspaces/${workspaceId}/settings/connection`;
  const headers = { 'content-type': 'application/json', 'accept-language': lang };
  const saved = await fetcher(url, { method: 'PUT', headers, body: JSON.stringify(connection) });
  const body = await saved.json().catch(() => null);
  if (!saved.ok) return { ok: false as const, error: body };
  const tested = await fetcher(url, { method: 'POST', headers, body: JSON.stringify({ message, language: lang, ...(typeof body?.revision === 'string' ? { revision: body.revision } : {}) }) });
  const test = await tested.json().catch(() => null);
  if (!tested.ok || test?.ready !== true || typeof test.reply !== 'string') return { ok: false as const, error: test, card: body?.card };
  const sdk = test.sdk && typeof test.sdk === 'object' ? { seen: test.sdk.seen === true, toolCalls: Number(test.sdk.toolCalls) || 0 } : null;
  return { ok: true as const, reply: test.reply as string, card: body?.card, sdk };
}

export function connectHref(home: string, mode: 'full' | 'quick', lang: Lang) {
  return `${home}?connect=${mode}&lang=${lang}`;
}
export function connectHomeHref(home: string, lang: Lang) { return `${home}?lang=${lang}`; }

export type SdkStatus = { key_last4: string | null; sdk_seen_at: string | null; sdk_version: string | null; tools: number; mcp_servers: number };
export async function readSdk(workspaceId: string, fetcher: typeof fetch = fetch): Promise<SdkStatus | null> {
  const response = await fetcher(`/api/workspaces/${workspaceId}/settings/sdk`, { cache: 'no-store' }).catch(() => null);
  return response?.ok ? await response.json().catch(() => null) as SdkStatus | null : null;
}
/** A new key is shown once. Making one turns off the old key. */
export async function makeKey(workspaceId: string, lang: string, fetcher: typeof fetch = fetch): Promise<{ key: string; last4: string } | null> {
  const response = await fetcher(`/api/workspaces/${workspaceId}/settings/sdk`, { method: 'POST', headers: { 'accept-language': lang } }).catch(() => null);
  return response?.ok ? await response.json().catch(() => null) as { key: string; last4: string } | null : null;
}
export async function turnOffKey(workspaceId: string, lang: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const response = await fetcher(`/api/workspaces/${workspaceId}/settings/sdk`, { method: 'DELETE', headers: { 'accept-language': lang } }).catch(() => null);
  return Boolean(response?.ok);
}
