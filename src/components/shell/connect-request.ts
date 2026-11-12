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
  return { ok: true as const, reply: test.reply as string, card: body?.card };
}

export function connectHref(home: string, mode: 'full' | 'quick', lang: Lang) {
  return `${home}?connect=${mode}${lang === 'ar' ? '&lang=ar' : ''}`;
}
export function connectHomeHref(home: string, lang: Lang) { return lang === 'ar' ? `${home}?lang=ar` : home; }
