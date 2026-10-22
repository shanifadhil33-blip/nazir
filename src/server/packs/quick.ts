import { z } from 'zod';
import type { FocusPack } from './schema';
import { packById } from './catalog';

export const planSize = z.enum(['quick', 'full']);
export type PlanSize = z.infer<typeof planSize>;
type Keyed = { stable_key: string; language: string };

/** Resolve the versioned data, never a random sample or a demo specific selection. */
export function quickCases<T extends Keyed>(pack: FocusPack, cases: T[]): T[] {
  const selected = pack.quick.keys.map((key) => {
    const prefix = { government: '', real_estate: 're_', ecommerce: 'ec_', clinics: 'cl_', schools: 'sc_' }[pack.id];
    const matches = cases.filter((c) => c.stable_key === key || c.stable_key === prefix + key);
    if (matches.length !== 1) throw new Error(`Quick case missing or ambiguous: ${key}`);
    return matches[0]!;
  });
  if (selected.length !== 16 || new Set(pack.quick.keys).size !== 16 ||
      selected.filter((c) => c.language === 'en').length !== 8 || selected.filter((c) => c.language === 'ar').length !== 8) {
    throw new Error('Quick check requires 16 unique cases, 8 English and 8 Arabic.');
  }
  return selected;
}

export function selectSize<T extends Keyed>(packId: string, cases: T[], size: PlanSize): T[] {
  if (size === 'full') return cases;
  const pack = packById(packId);
  if (!pack) throw new Error('Unknown focus pack.');
  return quickCases(pack, cases);
}
