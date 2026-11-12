import { z } from 'zod';
import type { FocusPack } from './schema';
import { packById } from './catalog';

export const planSize = z.enum(['quick', 'full']);
export type PlanSize = z.infer<typeof planSize>;
type Keyed = { stable_key: string; language: string };

/** Resolve the versioned data, never a random sample or a demo specific selection. */
export function quickCases<T extends Keyed>(pack: FocusPack, cases: T[], version = pack.quick.version): T[] {
  const selection = version === pack.quick.version ? pack.quick : pack.quick.previous?.find((item) => item.version === version);
  if (!selection) throw new Error('Unknown Quick selection version.');
  const count = version === pack.quick.version ? 8 : 16;
  const selected = selection.keys.map((key) => {
    const prefix = { government: '', real_estate: 're_', ecommerce: 'ec_', clinics: 'cl_', schools: 'sc_' }[pack.id];
    const matches = cases.filter((c) => c.stable_key === key || c.stable_key === prefix + key);
    if (matches.length !== 1) throw new Error(`Quick case missing or ambiguous: ${key}`);
    return matches[0]!;
  });
  if (selected.length !== count || new Set(selection.keys).size !== count ||
      selected.filter((c) => c.language === 'en').length !== count / 2 || selected.filter((c) => c.language === 'ar').length !== count / 2) {
    throw new Error('Quick selection must have unique questions and balanced languages.');
  }
  return selected;
}

export function selectSize<T extends Keyed>(packId: string, cases: T[], size: PlanSize): T[] {
  if (size === 'full') return cases;
  const pack = packById(packId);
  if (!pack) throw new Error('Unknown focus pack.');
  return quickCases(pack, cases);
}
