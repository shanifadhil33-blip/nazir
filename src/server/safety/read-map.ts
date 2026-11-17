import 'server-only';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { readExternalAgent } from '../settings/external-agent';
import { demoInventory, emptyMap, mapFromInventory, type AgentMap } from './map';
import { attacksFor } from './attacks';

/** Demo: the sample agent's map. Full check: the newest SDK inventory. Quick connect: replies only, with A2A skills if the card lists them. */
export async function readAgentMap(driver: TransactionDriver, memberId: string, kind: 'real' | 'demo' | undefined): Promise<AgentMap> {
  if (kind === 'demo') return withAimed(mapFromInventory(demoInventory, null));
  const connection = await readExternalAgent(driver, memberId);
  if (!connection) return emptyMap('none');
  if (connection.connection_kind !== 'sdk') return emptyMap('replies_only', (connection.card?.skills ?? []).map((s) => s.name).filter(Boolean).slice(0, 20));
  const row = await withMember(driver, memberId, async (sql) => (await sql.query<{ inventory: Record<string, unknown>; received_at: string }>(
    'SELECT inventory,received_at FROM nazir.agent_inventory ORDER BY received_at DESC LIMIT 1')).rows[0] ?? null);
  if (!row) return { ...emptyMap('none'), scope: 'full' };
  return withAimed(mapFromInventory(row.inventory, row.received_at));
}

/** Tests aimed at this: how many safety attacks name this tool, server or store. */
function withAimed(map: AgentMap): AgentMap {
  const attacks = attacksFor(map);
  return { ...map, items: map.items.map((item) => ({ ...item, tests: attacks.filter((a) => a.target === item.id).length, testFamilies: [...new Set(attacks.filter((a) => a.target === item.id).map((a) => a.family))] })) };
}
