'use client';

import { useMemberSnapshot } from './member-snapshot';
import Link from 'next/link';
import type { Messages } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { navIcon, navItems, navLabel, type NavId, type NavLinks } from './nav';

export function SideNav({ lang, seat, copy, canStart, homeOnly, links = {}, current: here = 'home' }: { lang: 'en' | 'ar'; seat: Seat; copy: Messages; canStart?: boolean; homeOnly?: boolean; links?: NavLinks; current?: NavId }) {
  const snapshot = useMemberSnapshot('');
  const restricted = homeOnly ?? (snapshot ? snapshot.kind !== 'demo' && !snapshot.connection?.ready : false);
  const items = restricted ? ['home' as const] : navItems(seat, canStart);
  return (
    <nav className="nz-side-nav" aria-label={copy.shell.nav} {...localeAttrs(lang)} data-seat={seat}>
      {items.map((id) => {
        const className = id === 'start' ? 'nz-side-start' : 'nz-side-item';
        const current = id === here ? 'page' : undefined;
        const inner = <><ShellIcon name={navIcon(id)} directional={id === 'start'} /><span>{navLabel(copy, id)}</span></>;
        const href = links[id];
        return href
          ? <Link key={id} href={href} className={className} data-nav={id} aria-current={current}>{inner}</Link>
          : <button key={id} type="button" className={className} data-nav={id} aria-current={current}>{inner}</button>;
      })}
      {links.settings || links.home ? <Link href={links.settings ?? `${links.home}?screen=settings`} className="nz-side-item" data-nav="settings" aria-current={here === 'settings' ? 'page' : undefined}><ShellIcon name="settings" /><span>{copy.shell.settings}</span></Link> : null}
    </nav>
  );
}
