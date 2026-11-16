import type { Lang } from '@/components/ocean/copy';

export function localeAttrs(lang: Lang): { lang: Lang; dir: 'ltr' | 'rtl' } {
  return { lang, dir: lang === 'ar' ? 'rtl' : 'ltr' };
}

/** Keep the chosen language when a shell tab opens another route. */
export function localeHref(href: string, lang: Lang) {
  const url = new URL(href, 'https://nazir.local');
  url.searchParams.set('lang', lang);
  return `${url.pathname}${url.search}${url.hash}`;
}
