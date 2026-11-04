import type { Messages } from '@/components/ocean/copy';
import type { Seat } from '@/components/ocean/model';

/** Male names from the brief: Khalid the owner, Omar the fixer, Yusuf the reviewer, Ahmed the viewer. */
export function personFor(seat: Seat, copy: Messages): { initials: string; name: string; full: string } {
  if (seat === 'supplier') return { initials: 'OS', name: copy.shell.omar, full: copy.shell.omar };
  if (seat === 'editor') return { initials: 'YR', name: copy.shell.yusuf, full: copy.shell.yusuf };
  if (seat === 'viewer') return { initials: 'AK', name: copy.shell.ahmed, full: copy.shell.ahmed };
  return { initials: 'KH', name: copy.shell.khalid, full: copy.shell.khalidFull };
}

/** Up to two initials from a real name. Arabic names use the first letter of each of the first two words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = words.map((word) => Array.from(word)[0] ?? '').join('');
  return /^[a-z]+$/i.test(letters) ? letters.toUpperCase() : letters;
}
