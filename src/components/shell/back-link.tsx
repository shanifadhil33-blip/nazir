import Link from 'next/link';
import type { Lang } from '@/components/ocean/copy';
import { localeHref } from './locale';
import { ShellIcon } from './icons';

/** A visible parent route on phones and desktops, independent of the current nav tab. */
export function BackLink({ href, label, lang }: { href: string; label: string; lang: Lang }) {
  return <Link className="nz-parent-back" href={localeHref(href, lang)}><ShellIcon name="play" directional /><span>{label}</span></Link>;
}
