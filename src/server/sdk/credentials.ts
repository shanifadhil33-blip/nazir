import 'server-only';
import { openKey } from '../settings/agent-settings';

export type CredentialContext = { connection: string | null; people: string | null };
/** Values live only in the ingest transaction. Neither encrypted context nor plaintext is returned. */
export function credentialsFor(context: CredentialContext, sdkKey: string): string[] {
  const values = [sdkKey];
  if (context.connection) values.push(openKey(context.connection));
  if (context.people) {
    const people = JSON.parse(openKey(context.people));
    if (typeof people?.a?.token !== 'string' || typeof people?.b?.token !== 'string') throw new Error('Invalid credential context');
    values.push(people.a.token, people.b.token);
  }
  return values;
}

/** Scrub before truncation, including strings containing serialized JSON and bare bearer values. */
export function credentialScrubber(values: readonly string[]) {
  const variants = new Set<string>();
  for (const value of values) for (const token of [value, value.replace(/^Bearer\s+/i, '')]) {
    if (!token) continue;
    let escaped = token;
    for (let depth = 0; depth < 3; depth++) { variants.add(escaped); variants.add(escaped.replaceAll('/', '\\/')); escaped = JSON.stringify(escaped).slice(1, -1); }
  }
  const exact = [...variants].sort((a, b) => b.length - a.length).map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`${exact ? `(?:${exact})|` : ''}\\bnzk_[0-9a-f]{32}_[A-Za-z0-9]{40}\\b|\\bBearer\\s+[A-Za-z0-9._~-]{8,}`, 'g');
  return (value: unknown): { value: unknown; found: boolean } => {
    let found = false;
    const text = (s: string) => s.replace(pattern, () => { found = true; return '[credential]'; });
    const walk = (item: unknown): unknown => {
      if (typeof item === 'string') return text(item);
      if (Array.isArray(item)) return item.map(walk);
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [text(key), walk(child)]));
      return item;
    };
    return { value: walk(value), found };
  };
}
