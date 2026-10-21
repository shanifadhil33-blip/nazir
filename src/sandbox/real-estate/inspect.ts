import { sandboxIdentifier } from '../../server/db/context';
import type { TransactionDriver } from '../../server/db/driver';

export type EstateListing = { unit: string; community: string; bedrooms: number; rent_aed: number; status: 'available' | 'reserved' | 'let'; permit_number: string; agent_key: string; agent_name: string; brn: string; tenant_key: string | null };
export type EstateRequest = { reference: string; requester_key: string; kind: 'viewing' | 'maintenance' | 'human_review'; unit: string | null; slot: string | null; queue: string; agent_key: string | null; status: string; seeded: boolean };
export type EstateReading = { tenant: string; listings: EstateListing[]; requests: EstateRequest[]; requesters: { requester_key: string; name: string; phone: string }[]; receipts: { tool: string; outcome: 'ok' | 'error' }[] };

/** Read only snapshot through the inspector role, the same fence the government channel uses. */
export async function readEstate(driver: TransactionDriver, tenant: string): Promise<EstateReading> {
  if (!sandboxIdentifier.test(tenant)) throw new Error('Invalid inspection tenant');
  return driver.transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await db.query('SET LOCAL ROLE nazir_inspector');
    await db.query("SELECT set_config('app.inspect_tenant',$1,true)", [tenant]);
    const listings = (await db.query<EstateListing>('SELECT l.unit,l.community,l.bedrooms,l.rent_aed,l.status,l.permit_number,l.agent_key,a.name AS agent_name,a.brn,l.tenant_key FROM sandbox.re_listings l JOIN sandbox.re_agents a ON a.tenant=l.tenant AND a.agent_key=l.agent_key WHERE l.tenant=$1 ORDER BY l.unit', [tenant])).rows.map((l) => ({ ...l, rent_aed: Number(l.rent_aed), bedrooms: Number(l.bedrooms) }));
    const requests = (await db.query<EstateRequest>('SELECT reference,requester_key,kind,unit,slot,queue,agent_key,status,seeded FROM sandbox.re_requests WHERE tenant=$1 ORDER BY created_at,reference', [tenant])).rows;
    const requesters = (await db.query<{ requester_key: string; name: string; phone: string }>('SELECT requester_key,name,phone FROM sandbox.re_requesters WHERE tenant=$1 ORDER BY requester_key', [tenant])).rows;
    const receipts = (await db.query<{ tool: string; outcome: 'ok' | 'error' }>('SELECT tool,outcome FROM sandbox.tool_receipts WHERE tenant=$1 ORDER BY created_at,id', [tenant])).rows;
    return { tenant, listings, requests, requesters, receipts };
  });
}
