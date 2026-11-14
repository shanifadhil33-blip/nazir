import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import 'server-only';
import type { RecordCheck } from '../checks/record-checks';
import { MAX_TURNS, nextLine, type PersonaFacts } from '../driver/driver';
import { whatItDid } from '../checks/trace-checks';
import { callExternalAgent, type ExternalMessage, type ExternalRow, type ExternalTransport } from '../settings/external-agent';

export function externalRecordChecks(ids: readonly string[], severity: RecordCheck['severity']): RecordCheck[] {
  return ids.map((id) => ({ id: id as RecordCheck['id'], status: 'inconclusive', severity,
    evidence: { expected: 'records link', observed: 'external_agent_no_records_link', records: [] },
    summary: { en: en.connect.replyScope, ar: ar.connect.replyScope } }));
}
/** Only resident and agent messages cross the boundary. No sandbox prompt, tools, judge or owner knowledge. */
export async function externalConversation(row: ExternalRow, turns: string[], sessionId: string, language: 'en' | 'ar', reserve: () => Promise<void>, options?: ExternalTransport, test?: { workspaceId: string; session: string; mode: 'quality' | 'security' }, facts: PersonaFacts = {}) {
  const transcript: ExternalMessage[] = [];
  const transport = { ...options, a2aContexts: new Map<string, string>() };
  const answered = new Set<string>();
  let reply = '';
  const queue = [...turns];
  // Scripted lines first. When the agent then asks the person something, the driver answers from the persona facts.
  for (let index = 0; index < MAX_TURNS && queue.length; index++) {
    const content = queue.shift()!;
    await reserve();
    transcript.push({ role: 'user', content });
    reply = await callExternalAgent(row, transcript, sessionId, language, test ? { ...transport, test: { ...test, turn: index + 1 } } : transport);
    transcript.push({ role: 'assistant', content: reply });
    if (!queue.length) {
      const next = nextLine(reply, facts, language, answered);
      if (next) { answered.add(next.topic); queue.push(next.line); }
    }
  }
  return { transcript, reply, replies: transcript.filter((m) => m.role === 'assistant').map((m) => m.content) };
}

/** A reply finding carries no simulated records and no connection configuration. */
export function externalReplyFinding(input: {
  workspaceId: string; runId: string; conversationId: string; scenarioId: string; attempt: number;
  language: string; agentVersionId: string; rulePackVersionId: string; sourceClause: string; severity: string;
  reply: string; semantic: import('../judge/judge').SemanticResult;
}) {
  const s = input.semantic;
  return {
    workspace_id: input.workspaceId, run_id: input.runId, conversation_id: input.conversationId, scenario_id: input.scenarioId,
    check_id: 'semantic', attempt: input.attempt, language: input.language, check_layer: 'semantic',
    title: s.labels.en, title_ar: s.labels.ar, agent_said: s.span || input.reply,
    really_happened: en.connect.replyScope,
    really_happened_ar: ar.connect.replyScope,
    rule_pack_version_id: input.rulePackVersionId, rule_clause: input.sourceClause, agent_version_id: input.agentVersionId,
    severity: input.severity, root_cause_class: 'unknown', owner_role: 'quality_reviewer',
    evidence: { source: 'external_agent', records_available: false, expected: 'chosen service rubric and owner knowledge', observed: { status: s.status, issue: s.issue, reason: s.reason },
      judge: { provider: s.provider, model: s.model, promptHash: s.promptHash, rubricVersion: s.rubricVersion } },
  };
}

/** A wrong answer proven from the SDK trace: what the agent said next to what it really did. */
export function externalTraceFinding(input: {
  workspaceId: string; runId: string; conversationId: string; scenarioId: string; attempt: number; language: string;
  agentVersionId: string; rulePackVersionId: string; sourceClause: string; reply: string; check: import('../checks/trace-checks').TraceCheck; spans: import('../checks/trace-checks').TraceSpan[];
}) {
  return {
    workspace_id: input.workspaceId, run_id: input.runId, conversation_id: input.conversationId, scenario_id: input.scenarioId,
    check_id: input.check.id, attempt: input.attempt, language: input.language, check_layer: 'record',
    title: input.check.summary.en, title_ar: input.check.summary.ar, agent_said: input.reply || '(no reply)',
    really_happened: whatItDid(input.spans, 'en'), really_happened_ar: whatItDid(input.spans, 'ar'),
    rule_pack_version_id: input.rulePackVersionId, rule_clause: input.sourceClause, agent_version_id: input.agentVersionId,
    severity: input.check.severity, root_cause_class: 'unknown', owner_role: 'quality_reviewer',
    evidence: { source: 'sdk_trace', records_available: true, expected: input.check.evidence.expected, observed: input.check.evidence.observed, records: input.check.evidence.records },
  };
}
