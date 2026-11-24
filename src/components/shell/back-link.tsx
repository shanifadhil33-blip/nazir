import Link from 'next/link';
import { ShellIcon } from './icons';

/** A visible parent route on phones and desktops, independent of the current nav tab. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return <Link className="nz-parent-back" href={href}><ShellIcon name="play" directional /><span>{label}</span></Link>;
}
