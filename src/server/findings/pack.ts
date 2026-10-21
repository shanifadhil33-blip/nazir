import { hash } from '../../sandbox/demo-rule-pack';
import type { RecordCheck } from '../checks/record-checks';
import type { SemanticResult } from '../judge/judge';
import type { InlineCase } from '../packs/schema';
import type { PackRuntime, PackVersion } from '../packs/runtime';
import type { Message } from '../../sandbox/agent';
import { lessonsForFinding, type FrozenLesson } from '../memory/frozen';

type Receipt = { tool: string; outcome: string; error?: string };
/** Where a pack failure most likely comes from, read from its receipts and check. */
export function packRootCause(id: string, issue: string, receipts: Receipt[], writeTools: readonly string[]) {
  if (id === 'ownership') return 'missing_authorization';
  const writes = receipts.filter((r) => writeTools.includes(r.tool));
  if (writes.some((r) => r.error === 'invalid_arguments')) return 'wrong_tool_argument';
  if (id === 'semantic') {
    if (['wrong_policy', 'incomplete'].includes(issue)) return 'knowledge_or_source';
    if (['missing_refusal', 'unneeded_refusal', 'out_of_scope', 'wrong_language', 'instruction_in_reply'].includes(issue)) return 'prompt_ambiguity';
    return writes.some((r) => r.outcome === 'error') ? 'adapter_failure' : 'unknown';
  }
  if (writes.some((r) => r.outcome === 'error')) return 'adapter_failure';
  if (writes.some((r) => r.outcome === 'ok')) return 'workflow_failure';
  return 'prompt_ambiguity';
}
export function buildPackFindings(input: { runtime: PackRuntime; scenarioRow: { id: string; stable_key: string; content_hash: string; language: string; family: string }; scenario: InlineCase; reply: string; transcript: Message[]; toolCalls: { name: string; result: { ok: boolean; error?: string } }[]; reading: unknown; records: RecordCheck[]; semantic: SemanticResult | null; workspaceId: string; runId: string; conversationId: string; attempt: number; agentVersionId: string; rulePackVersionId: string; version: PackVersion; lessons?: FrozenLesson[] }) {
  const { runtime, scenario, scenarioRow, records, semantic } = input;
  const facts = runtime.facts(input.reading, scenario).text;
  const receipts = input.toolCalls.map((t, i) => ({ id: String(i + 1), tool: t.name, outcome: t.result.ok ? 'ok' : 'error', error: t.result.ok ? undefined : t.result.error }));
  const writeTools = runtime.toolNames.filter((n) => !/^(get_|list_|search_|check_)/.test(n));
  const entries: { id: string; title: { en: string; ar: string }; said: string; expected: unknown; observed: unknown; issue: string; severity: string }[] = records.filter((r) => r.status === 'fail').map((r) => ({ id: r.id, title: r.summary, said: input.reply, expected: r.evidence.expected, observed: r.evidence.observed, issue: '', severity: r.severity }));
  if (semantic?.status === 'contradicted') entries.push({ id: 'semantic', title: semantic.labels, said: semantic.span, expected: scenario.expected, observed: { status: semantic.status, issue: semantic.issue, facts }, issue: semantic.issue, severity: scenario.severity });
  return entries.map((entry) => {
    const cause = packRootCause(entry.id, entry.issue, receipts, writeTools);
    const used = lessonsForFinding(input.lessons, scenarioRow.family, entry.id);
    return { workspace_id: input.workspaceId, run_id: input.runId, conversation_id: input.conversationId, scenario_id: scenarioRow.id, check_id: entry.id, attempt: input.attempt, language: scenarioRow.language, check_layer: entry.id === 'semantic' ? 'semantic' : 'record', title: entry.title.en, title_ar: entry.title.ar, agent_said: entry.said || input.reply || '(no reply)', really_happened: facts.en.trim(), really_happened_ar: facts.ar.trim(), rule_pack_version_id: input.rulePackVersionId, rule_clause: scenario.source_clause, agent_version_id: input.agentVersionId, severity: entry.id === 'ownership' ? 'critical' : entry.severity, root_cause_class: cause, owner_role: cause === 'unknown' ? 'quality_reviewer' : 'supplier_maintainer',
      evidence: { pack: runtime.id, run_id: input.runId, conversation_id: input.conversationId, attempt: input.attempt, scenario_key: scenarioRow.stable_key, scenario_hash: scenarioRow.content_hash, rule_clause: runtime.clause(scenario.source_clause), rule_pack_version_id: input.rulePackVersionId, agent_version_id: input.agentVersionId, registry_id: input.version.id, config_hash: input.version.configHash, receipts, receipts_reason: receipts.length ? null : { en: 'no tool was called', ar: 'لم تستدع أي أداة' }, expected: entry.expected ?? 'as recorded', observed: entry.observed ?? 'none', reading_hash: hash(input.reading), transcript_hash: hash(input.transcript), ...(entry.id === 'semantic' ? { judge: { provider: semantic!.provider, model: semantic!.model, promptHash: semantic!.promptHash, rubricVersion: semantic!.rubricVersion } } : {}) },
      ...(used.length ? { lessons_used: used } : {}) };
  });
}
/** A pack check in the shape the runner stores and the evidence page shows. */
export function packRecord(runtime: PackRuntime, scenario: InlineCase, check: { id: string; status: 'pass' | 'fail' | 'inconclusive'; evidence: { expected: unknown; observed: unknown } }): RecordCheck {
  const label = runtime.pack.record_checks.find((c) => c.id === check.id);
  return { id: check.id, status: check.status, severity: scenario.severity, evidence: { expected: check.evidence.expected, observed: check.evidence.observed, records: [] }, summary: { en: label?.en ?? check.id, ar: label?.ar ?? check.id } } as unknown as RecordCheck;
}
