import type { Lang } from '@/components/ocean/copy';

export function localeAttrs(lang: Lang): { lang: Lang; dir: 'ltr' | 'rtl' } {
  return { lang, dir: lang === 'ar' ? 'rtl' : 'ltr' };
}
