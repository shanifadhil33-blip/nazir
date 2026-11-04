import type { Messages } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';
import type { ShellIconName } from './icons';

export const navOrder = ['home', 'checks', 'start', 'fixes', 'more'] as const;
export type NavId = (typeof navOrder)[number];

/** Logical reading order. The centre start action is omitted for a viewer. */
export function navItems(seat: Seat, canStart: boolean = seat !== 'viewer'): NavId[] {
  return navOrder.filter((id) => id !== 'start' || canStart);
}

/** Where each nav item goes. Missing entries stay plain buttons. */
export type NavLinks = Partial<Record<NavId, string>>;

/** Visual order after the document direction mirrors a row. Tab order stays logical. */
export function visualNavOrder(items: readonly NavId[], dir: 'ltr' | 'rtl'): NavId[] {
  return dir === 'rtl' ? [...items].reverse() : [...items];
}

export function navLabel(copy: Messages, id: NavId): string {
  if (id === 'home') return copy.shell.home;
  if (id === 'checks') return copy.shell.checks;
  if (id === 'start') return copy.shell.startCheck;
  if (id === 'fixes') return copy.shell.fixes;
  return copy.shell.more;
}

export function navIcon(id: NavId): ShellIconName {
  if (id === 'home') return 'home';
  if (id === 'checks') return 'checks';
  if (id === 'start') return 'play';
  if (id === 'fixes') return 'pencil';
  return 'more';
}
