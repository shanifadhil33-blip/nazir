import type { Messages } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import { ShellIcon } from './icons';
import { localeAttrs } from './locale';
import { navIcon, navItems, navLabel } from './nav';

export function SideNav({ lang, seat, copy }: { lang: 'en' | 'ar'; seat: Seat; copy: Messages }) {
  const items = navItems(seat);
  return (
    <nav className="nz-side-nav" aria-label={copy.shell.nav} {...localeAttrs(lang)} data-seat={seat}>
      {items.map((id) => (
        <button
          key={id}
          type="button"
          className={id === 'start' ? 'nz-side-start' : 'nz-side-item'}
          data-nav={id}
          aria-current={id === 'home' ? 'page' : undefined}
        >
          <ShellIcon name={navIcon(id)} directional={id === 'start'} />
          <span>{navLabel(copy, id)}</span>
        </button>
      ))}
    </nav>
  );
}
