// A measured 48 case Government run used about 180 calls, under four per attempt.
export const estimatedCallsPerAttempt = 4;

export type EstimateRules = {
  scenario_ids?: string[];
  planned_calls?: number;
  calls_per_attempt?: number;
};
export function scenarioAttempts(repeats: number, override = 0) {
  return Math.min(3, Math.max(repeats, override));
}
export function estimateRun(scenarioIds: string[], repeats: number, repeatsFor: Record<string, number> = {}, rules: EstimateRules = {}) {
  const attemptsFor = Object.fromEntries(scenarioIds.map((id) => [id, scenarioAttempts(repeats, repeatsFor[id])]));
  const attempts = Object.values(attemptsFor).reduce((sum, count) => sum + count, 0);
  const plannedScenarios = rules.scenario_ids?.length || scenarioIds.length;
  const plannedRate = rules.calls_per_attempt ?? (rules.planned_calls === undefined ? undefined : rules.planned_calls / plannedScenarios);
  const callsPerAttempt = typeof plannedRate === 'number' && Number.isFinite(plannedRate) && plannedRate > 0 ? plannedRate : estimatedCallsPerAttempt;
  return { attemptsFor, attempts, estimatedCalls: Math.ceil(attempts * callsPerAttempt) };
}
