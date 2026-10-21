import government from './government/pack.json';
import realEstate from './real-estate/pack.json';
import ecommerce from './ecommerce/pack.json';
import clinics from './clinics/pack.json';
import { packSchema, type FocusPack, type PackId } from './schema';
/** Parsed once at import. A malformed pack fails the build, not a request. */
export const focusPacks: readonly FocusPack[] = Object.freeze([government, realEstate, ecommerce, clinics].map((p) => packSchema.parse(p)));
export const livePacks = focusPacks.filter((p) => p.status === 'live');
export const livePackIds = livePacks.map((p) => p.id) as PackId[];
export function packById(id: string) { return focusPacks.find((p) => p.id === id) ?? null; }
/** What a screen may show about a pack: names and counts, never cases or rubrics. */
export function packSummary(p: FocusPack) {
  return { id: p.id, version: p.version, name: p.name, summary: p.summary, cases: p.cases.count, record_checks: p.record_checks.length, refusal_policies: p.refusal_policies.length, compliance: p.compliance.length };
}
