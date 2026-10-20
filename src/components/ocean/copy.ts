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
