import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import 'server-only';
import type { RecordCheck } from '../checks/record-checks';
import { callExternalAgent, type ExternalMessage, type ExternalRow, type ExternalTransport } from '../settings/external-agent';

export function externalRecordChecks(ids: readonly string[], severity: RecordCheck['severity']): RecordCheck[] {
  return ids.map((id) => ({ id: id as RecordCheck['id'], status: 'inconclusive', severity,
    evidence: { expected: 'records link', observed: 'external_agent_no_records_link', records: [] },
    summary: { en: en.connect.replyScope, ar: ar.connect.replyScope } }));
}
/** Only resident and agent messages cross the boundary. No sandbox prompt, tools, judge or owner knowledge. */
export async function externalConversation(row: ExternalRow, turns: string[], sessionId: string, language: 'en' | 'ar', reserve: () => Promise<void>, options?: ExternalTransport, test?: { workspaceId: string; session: string; mode: 'quality' | 'security' }) {
  const transcript: ExternalMessage[] = [];
  const transport = { ...options, a2aContexts: new Map<string, string>() };
  let reply = '';
  for (const [index, content] of turns.entries()) {
    await reserve();
    transcript.push({ role: 'user', content });
    reply = await callExternalAgent(row, transcript, sessionId, language, test ? { ...transport, test: { ...test, turn: index + 1 } } : transport);
    transcript.push({ role: 'assistant', content: reply });
  }
  return { transcript, reply };
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
