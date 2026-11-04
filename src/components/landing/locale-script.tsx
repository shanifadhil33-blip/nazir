import type { Lang } from '@/components/ocean/copy';
import { localeAttrs } from '@/components/shell/locale';

/** Sets language and direction before first paint so Arabic never flashes left to right. */
export function LocaleScript({ lang }: { lang: Lang }) {
  const { dir } = localeAttrs(lang);
  return <script>{`document.documentElement.lang=${JSON.stringify(lang)};document.documentElement.dir=${JSON.stringify(dir)};`}</script>;
}
