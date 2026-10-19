// Retest selection after an approved repair (brief section 13 and 14). Pure and documented in docs/repair.md.
export type RetestScenario = { id: string; meaning_id: string; meaning_key: string | null; meaning_kind: string | null; family: string; split: string; stable_key: string; language: string; library: boolean };
// Hidden families related to each family's group. Legacy complaint journey scenarios map to the routing family.
export const relatedHidden: Record<string, string> = {
  correct_reference_rules: 'wrong_routing_queue', missing_required_details: 'wrong_routing_queue',
  complaint_vs_suggestion: 'wrong_routing_queue', unresolved_prior_request: 'wrong_routing_queue',
  success_without_case: 'wrong_routing_queue', wrong_routing_queue: 'wrong_routing_queue',
  open_case_described_resolved: 'repeated_request_duplicates', repeated_request_duplicates: 'repeated_request_duplicates',
  another_requesters_case: 'broad_case_export', broad_case_export: 'broad_case_export',
  english_msa_equivalent: 'mixed_names_and_numerals', mixed_names_and_numerals: 'mixed_names_and_numerals',
  complaint: 'wrong_routing_queue',
};
export const retryFamily = 'repeated_request_duplicates';
export const callsPerScenario = 8;
export const budgetFor = (count: number, cap: number) => Math.max(1, Math.min(cap, count * callsPerScenario));
const exposureKey = (s: RetestScenario) => s.meaning_key ?? s.meaning_id;
/** One scenario per stable key and language; a library scenario wins over an older fixture scenario with the same key. */
export function onePerKey(list: RetestScenario[]) {
  const best = new Map<string, RetestScenario>();
  for (const s of [...list].sort((a, b) => a.id.localeCompare(b.id))) {
    const k = `${s.stable_key}:${s.language}`, cur = best.get(k);
    if (!cur || (!cur.library && s.library)) best.set(k, s);
  }
  return [...best.values()].sort((a, b) => `${a.stable_key}:${a.language}`.localeCompare(`${b.stable_key}:${b.language}`));
}
export function selectRetest(finding: RetestScenario, approved: RetestScenario[], usedMeaningKeys: Set<string>) {
  const all = onePerKey(approved);
  const ids = (list: RetestScenario[]) => list.map((s) => s.id);
  const affected = all.filter((s) => s.meaning_id === finding.meaning_id || (finding.meaning_key && s.meaning_key === finding.meaning_key));
  if (!affected.some((s) => s.id === finding.id)) affected.unshift(finding);
  const taken = new Set(ids(affected));
  const normal = all.filter((s) => !taken.has(s.id) && s.family === finding.family && s.meaning_kind === 'normal');
  normal.forEach((s) => taken.add(s.id));
  const retryAll = all.filter((s) => !taken.has(s.id) && s.family === retryFamily);
  const retryNormal = retryAll.filter((s) => s.meaning_kind === 'normal');
  const retry = retryNormal.length ? retryNormal : retryAll;
  retry.forEach((s) => taken.add(s.id));
  const related = relatedHidden[finding.family];
  const hidden = all.filter((s) => !taken.has(s.id) && s.split === 'hidden' && s.family === related && !usedMeaningKeys.has(exposureKey(s)));
  const retest = [...affected, ...normal, ...retry, ...hidden];
  return { affected: ids(affected), normal: ids(normal), retry: ids(retry), hidden: ids(hidden), retest: ids(retest), suite: ids(all) };
}
