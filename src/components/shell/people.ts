import { fill, type Messages } from '@/components/ocean/copy';
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

/** Who the header names. While a page is still loading and the person is not known yet, it names no one rather than someone else. */
export function whoFor(person: { initials: string; name: string } | undefined | null, seat: Seat, copy: Messages, loading: boolean): { initials: string; name: string; full: string } {
  if (person) return { ...person, full: person.name };
  return loading ? { initials: '', name: '', full: '' } : personFor(seat, copy);
}

/** The line under the name. Empty while loading, so no made up workspace name flashes first. */
export function helpLine(assistant: string | undefined, copy: Messages, loading: boolean): string {
  return assistant && !/^nazir demo$/i.test(assistant.trim()) ? assistant : (loading ? '' : copy.agentStatus.none);
}

/** The account kind and successful current test are trusted server facts. Never use an account name. */
export function agentHeader(kind: 'demo' | 'real' | undefined, connection: { ready: boolean; name: string } | null | undefined, copy: Messages) {
  if (kind === 'demo') return fill(copy.agentStatus.header, { agent: copy.shell.helpDesk });
  return connection?.ready === true ? fill(copy.agentStatus.header, { agent: connection.name }) : copy.agentStatus.none;
}
