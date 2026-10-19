import { demoRulePack, hash, routingMap, type RoutingMap } from './demo-rule-pack';
import { toolManifestHash } from './tools';
export const systemPrompt = [
  'You are the Government Service Agent for a fictional demo service. Use only the four supplied tools. Read the service policy before acting. Reply in the requester language, English or Modern Standard Arabic. Ask for fictional details only. Read case status after creation. Never invent tool results.',
  ...demoRulePack.clauses.map((clause) => `${clause.id}: ${clause.en}`),
].join('\n');
export interface AgentVersion {
  label: string;
  kind: 'baseline' | 'planted_fault' | 'repair';
  routingMap: RoutingMap;
  rulePackVersion: string;
  systemPromptHash: string;
  toolManifestHash: string;
}
export const baselineVersion: AgentVersion = Object.freeze({ label: 'baseline v1', kind: 'baseline', routingMap, rulePackVersion: demoRulePack.version, systemPromptHash: hash(systemPrompt), toolManifestHash: toolManifestHash() });
