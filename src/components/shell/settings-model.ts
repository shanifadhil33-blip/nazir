import type { Lang, Messages } from '@/components/ocean/copy';
import { can, type Role } from '@/server/auth/roles';

export type SettingsAccess = { edit: boolean; reset: boolean };

/** Editing follows agent.write, starting again follows demo.reset. Everyone else can only look. */
export function settingsAccess(roles: readonly string[]): SettingsAccess {
  return { edit: can(roles as Role[], 'agent.write'), reset: can(roles as Role[], 'demo.reset') };
}

export type PersonRow = { initials: string; name: string };

export type SettingsView = {
  assistant: string;
  demo?: boolean;
  connected?: boolean;
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
  return [{ initials: 'OS', name: copy.shell.omar }];
}
