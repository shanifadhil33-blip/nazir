import { sandboxIdentifier } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import type { InlineCase } from '../packs/schema';

/** Test setup for one Real estate case: the synthetic listings, agents and tenants, plus any request the case starts with. */
export async function prepareEstateCase(driver: TransactionDriver, tenant: string, scenario: InlineCase) {
  if (!sandboxIdentifier.test(tenant)) throw new Error('Invalid sandbox tenant');
  await driver.transaction(async (db) => {
    await db.query('SET LOCAL ROLE nazir_worker');
    await db.query('SELECT sandbox.re_seed_tenant($1)', [tenant]);
    for (const r of scenario.starting_state.requests) {
      await db.query('SELECT sandbox.re_seed_request($1,$2,$3,$4,$5,$6,$7)', [tenant, scenario.persona.requester_key, r.kind, r.unit ?? null, r.slot ?? null, r.queue, r.agent_key ?? null]);
    }
  });
}
