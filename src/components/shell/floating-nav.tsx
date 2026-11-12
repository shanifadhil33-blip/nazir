'use client';

import { useMemberSnapshot } from './member-snapshot';
import Link from 'next/link';
import type { Messages } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { navIcon, navItems, navLabel, type NavId, type NavLinks } from './nav';

export function FloatingBottomNav({ lang, seat, copy, canStart, homeOnly, links = {}, current = 'home' }: { lang: 'en' | 'ar'; seat: Seat; copy: Messages; canStart?: boolean; homeOnly?: boolean; links?: NavLinks; current?: NavId }) {
  const snapshot = useMemberSnapshot('');
  const restricted = homeOnly ?? (snapshot ? snapshot.kind !== 'demo' && !snapshot.connection?.ready : false);
  const items = restricted ? ['home' as const] : navItems(seat, canStart);
  return (
    <nav className="nz-float-nav" aria-label={copy.shell.nav} {...localeAttrs(lang)} data-seat={seat}>
      <div className="nz-float-bar">
        {items.map((id) => <FloatItem key={id} id={id} label={navLabel(copy, id)} current={id === current} href={links[id]} />)}
      </div>
    </nav>
  );
}

function FloatItem({ id, label, current, href }: { id: NavId; label: string; current: boolean; href?: string }) {
  const start = id === 'start';
  const className = start ? 'nz-float-start' : 'nz-float-item';
  const icon = <ShellIcon name={navIcon(id)} directional={start} />;
  if (href) return <Link href={href} className={className} data-nav={id} aria-current={current ? 'page' : undefined} aria-label={label}>{icon}<span>{label}</span></Link>;
  return (
    <button type="button" className={className} data-nav={id} aria-current={current ? 'page' : undefined} aria-label={label}>
      {icon}<span>{label}</span>
    </button>
  );
}
