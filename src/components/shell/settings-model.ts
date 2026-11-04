import type { Lang, Messages } from '@/components/ocean/copy';
import { can, type Role } from '@/server/auth/roles';

export type SettingsAccess = { edit: boolean; reset: boolean };

/** Editing follows agent.write, starting again follows demo.reset. Everyone else can only look. */
export function settingsAccess(roles: readonly string[]): SettingsAccess {
  return { edit: can(roles as Role[], 'agent.write'), reset: can(roles as Role[], 'demo.reset') };
}

export type PersonRow = { initials: string; name: string; role: 'owner' | 'fixer' | 'reviewer' | 'viewer' };

/** The strongest role a person holds, in the words of the brief. */
export function roleWord(roles: readonly string[]): PersonRow['role'] {
  if (roles.includes('service_owner')) return 'owner';
  if (roles.includes('supplier_maintainer')) return 'fixer';
  if (roles.includes('quality_reviewer')) return 'reviewer';
  return 'viewer';
}

export function roleLabel(role: PersonRow['role'], copy: Messages): string {
  return copy.settingsScreen[role];
}

export type SettingsView = {
  assistant: string;
  /** Focus pack id. */
  topic: string;
  language: Lang;
  people: PersonRow[];
};

export function topicLabel(topic: string, copy: Messages): string {
  const names = copy.settings.packNames as Record<string, string>;
  return names[topic] ?? names.government!;
}

/** Made up people for the preview page only. */
export function previewPeople(copy: Messages): PersonRow[] {
  return [
    { initials: 'KH', name: copy.shell.khalid, role: 'owner' },
    { initials: 'OS', name: copy.shell.omar, role: 'fixer' },
    { initials: 'YR', name: copy.shell.yusuf, role: 'reviewer' },
    { initials: 'AK', name: copy.shell.ahmed, role: 'viewer' },
  ];
}
