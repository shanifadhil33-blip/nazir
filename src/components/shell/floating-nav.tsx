import type { Messages } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { navIcon, navItems, navLabel, type NavId } from './nav';

export function FloatingBottomNav({ lang, seat, copy }: { lang: 'en' | 'ar'; seat: Seat; copy: Messages }) {
  const items = navItems(seat);
  return (
    <nav className="nz-float-nav" aria-label={copy.shell.nav} {...localeAttrs(lang)} data-seat={seat}>
      <div className="nz-float-bar">
        {items.map((id) => <FloatItem key={id} id={id} label={navLabel(copy, id)} current={id === 'home'} />)}
      </div>
    </nav>
  );
}

function FloatItem({ id, label, current }: { id: NavId; label: string; current: boolean }) {
  const start = id === 'start';
  return (
    <button
      type="button"
      className={start ? 'nz-float-start' : 'nz-float-item'}
      data-nav={id}
      aria-current={current ? 'page' : undefined}
      aria-label={label}
    >
      <ShellIcon name={navIcon(id)} directional={start} />
    </button>
  );
}
