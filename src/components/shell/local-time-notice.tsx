'use client';

import { useSyncExternalStore } from 'react';
import { fill, type Lang } from '@/components/ocean/copy';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function localTimeText(at: string, lang: Lang, timeZone?: string) {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}),
  }).format(new Date(at));
}

/** Reserve the notice on the server; reveal only the browser's local time after hydration. */
export function LocalTimeNotice({ at, lang, template }: { at: string; lang: Lang; template: string }) {
  const client = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const text = fill(template, { time: localTimeText(at, lang, client ? undefined : 'UTC') });
  return <p className="nz-note-line nz-local-time" role="status" data-ready={client}>
    <span aria-hidden={!client || undefined}>{text}</span>
  </p>;
}
