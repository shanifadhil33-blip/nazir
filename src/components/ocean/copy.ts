import arJson from '../../../messages/ar.json';
import en from '../../../messages/en.json';

export type Messages = typeof en;
export type Lang = 'en' | 'ar';

export const ar: Messages = arJson;

export function messagesFor(lang: Lang): Messages {
  return lang === 'ar' ? ar : en;
}

export function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? '');
}

/** Safety refusals always use the current screen language, regardless of API fallback text. */
export function settingsError(payload: unknown, copy: Messages, fallback: string): string {
  const code = payload && typeof payload === 'object' && 'error' in payload
    ? (payload as { error?: { code?: unknown } | null }).error?.code : undefined;
  if (code === 'external_private_address') return copy.settings.connectionPrivateAddress;
  if (code === 'external_safety') return copy.settings.connectionSafety;
  return fallback;
}
