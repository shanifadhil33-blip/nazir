'use client';

import { useEffect } from 'react';
import type { Lang } from '@/components/ocean/copy';
import { localeAttrs } from './locale';

/** Puts the active locale on the document element so layout direction and the Arabic font follow the screen. */
export function DocumentLocale({ lang }: { lang: Lang }) {
  useEffect(() => {
    const root = document.documentElement;
    const next = localeAttrs(lang);
    const previous = { lang: root.lang, dir: root.dir };
    root.lang = next.lang;
    root.dir = next.dir;
    return () => {
      root.lang = previous.lang;
      root.dir = previous.dir;
    };
  }, [lang]);
  return null;
}
