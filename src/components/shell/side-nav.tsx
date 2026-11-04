import Link from 'next/link';
import type { Messages } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { navIcon, navItems, navLabel, type NavLinks } from './nav';

export function SideNav({ lang, seat, copy, canStart, links = {} }: { lang: 'en' | 'ar'; seat: Seat; copy: Messages; canStart?: boolean; links?: NavLinks }) {
  const items = navItems(seat, canStart);
  return (
    <nav className="nz-side-nav" aria-label={copy.shell.nav} {...localeAttrs(lang)} data-seat={seat}>
      {items.map((id) => {
        const className = id === 'start' ? 'nz-side-start' : 'nz-side-item';
        const current = id === 'home' ? 'page' : undefined;
        const inner = <><ShellIcon name={navIcon(id)} directional={id === 'start'} /><span>{navLabel(copy, id)}</span></>;
        const href = links[id];
        return href
          ? <Link key={id} href={href} className={className} data-nav={id} aria-current={current}>{inner}</Link>
          : <button key={id} type="button" className={className} data-nav={id} aria-current={current}>{inner}</button>;
      })}
    </nav>
  );
}
