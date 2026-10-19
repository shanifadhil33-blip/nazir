import { z } from 'zod';
import { getAgentVersion, type AgentVersion } from '../../sandbox/versions';
import { hash, routingMap as approvedRouting, type Category } from '../../sandbox/demo-rule-pack';

// A repair can only remove a planted fault or restore the approved routing. It can never add anything.
export const repairOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('restore_routing'), category: z.enum(['complaint', 'suggestion', 'information']) }).strict(),
  z.object({ op: z.literal('remove_create_case_fault') }).strict(),
  z.object({ op: z.literal('remove_false_submit_claim') }).strict(),
]);
export const repairPatch = z.array(repairOp).min(1).max(5);
export type RepairOp = z.infer<typeof repairOp>;
export type RepairPatch = z.infer<typeof repairPatch>;
export const repairParents = ['baseline', 'planted_wrong_queue', 'planted_false_submit'] as const;
export const repairDisclosure = Object.freeze({
  en: 'Repaired version of a demo version, made from an approved proposal.',
  ar: 'نسخة مصلحة من نسخة العرض، أنشئت من مقترح تمت الموافقة عليه.',
});
export class RepairRefused extends Error { constructor(public code: 'unknown_parent' | 'invalid_patch' | 'duplicate_op' | 'no_change') { super(code); } }
const opKey = (op: RepairOp) => op.op === 'restore_routing' ? `${op.op}:${op.category}` : op.op;

/** Build the executable repaired version from a registry parent and an allowlisted patch. */
export function resolveRepairVersion(parentRegistryId: string, patch: unknown): AgentVersion {
  const parent = (repairParents as readonly string[]).includes(parentRegistryId) ? getAgentVersion(parentRegistryId) : null;
  if (!parent) throw new RepairRefused('unknown_parent');
  const parsed = repairPatch.safeParse(patch);
  if (!parsed.success) throw new RepairRefused('invalid_patch');
  const ops = parsed.data;
  if (new Set(ops.map(opKey)).size !== ops.length) throw new RepairRefused('duplicate_op');
  const routing: Record<Category, string> = { ...parent.routingMap };
  let faults = parent.faults, falseSubmitClaim = parent.falseSubmitClaim, changed = 0;
  for (const op of ops) {
    if (op.op === 'restore_routing' && routing[op.category] !== approvedRouting[op.category]) { routing[op.category] = approvedRouting[op.category]; changed++; }
    if (op.op === 'remove_create_case_fault' && faults) { faults = undefined; changed++; }
    if (op.op === 'remove_false_submit_claim' && falseSubmitClaim) { falseSubmitClaim = undefined; changed++; }
  }
  if (changed !== ops.length) throw new RepairRefused('no_change');
  const config: Omit<AgentVersion, 'configHash'> = {
    id: 'repair', label: 'Repaired version', kind: 'repair', disclosure: repairDisclosure,
    routingMap: Object.freeze(routing), rulePackVersion: parent.rulePackVersion, systemPromptHash: parent.systemPromptHash, toolManifestHash: parent.toolManifestHash,
    ...(faults ? { faults } : {}), ...(falseSubmitClaim ? { falseSubmitClaim } : {}),
  };
  return Object.freeze({ ...config, configHash: hash({ ...config, parent: parentRegistryId, patch: ops }) });
}
export type RepairConfig = { registry_id: 'repair'; parent_registry_id: string; patch: RepairPatch; executable_hash: string };
export function repairConfig(parentRegistryId: string, patch: unknown): RepairConfig {
  const version = resolveRepairVersion(parentRegistryId, patch);
  return { registry_id: 'repair', parent_registry_id: parentRegistryId, patch: repairPatch.parse(patch), executable_hash: version.configHash };
}
/** One resolver for enqueue and the worker: registry ids, or a stored repair config. Refuses drift. */
export function resolveExecutable(config: { registry_id?: string; parent_registry_id?: string; patch?: unknown; executable_hash?: string } | null | undefined): AgentVersion | null {
  if (!config?.registry_id) return null;
  if (config.registry_id !== 'repair') return getAgentVersion(config.registry_id);
  try {
    const version = resolveRepairVersion(String(config.parent_registry_id), config.patch);
    return version.configHash === config.executable_hash ? version : null;
  } catch { return null; }
}
