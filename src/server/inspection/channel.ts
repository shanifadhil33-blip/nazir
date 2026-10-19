import 'server-only';
import { sandboxIdentifier } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';

export type InspectedCase = { id: string; reference: string; requesterKey: string; category: string; queue: string; status: string; priorRequestRef: string | null; escalation: { id?: string; queue: string; status: string } | null };
export type InspectedEscalation = { id: string; queue: string; status: string };
export type InspectedReceipt = { id: string; tool: string; outcome: 'ok' | 'error'; error: string | null; createdAt: string };
export type StateReading = { tenant: string; takenAt: string; cases: InspectedCase[]; receipts: InspectedReceipt[]; tenantFaults?: { tool: string }[] };
type CaseRow = { id: string; reference: string; requester_key: string; category: string; queue: string; status: string; prior_request_ref: string | null; escalation_id: string | null; escalation_queue: string | null; escalation_status: string | null };
type ReceiptRow = { id: string; tool: string; outcome: 'ok' | 'error'; error: string | null; created_at: Date | string };
const iso = (value: Date | string) => new Date(value).toISOString();
const caseQuery = `SELECT c.id,c.reference,c.requester_key,c.category,c.queue,c.status,c.prior_request_ref,e.id AS escalation_id,e.queue AS escalation_queue,e.status AS escalation_status
 FROM sandbox.cases c LEFT JOIN sandbox.escalations e ON e.tenant=c.tenant AND e.case_id=c.id`;
const caseObject = (row: CaseRow): InspectedCase => ({ id: row.id, reference: row.reference, requesterKey: row.requester_key, category: row.category, queue: row.queue, status: row.status, priorRequestRef: row.prior_request_ref, escalation: row.escalation_queue === null ? null : { id: row.escalation_id!, queue: row.escalation_queue, status: row.escalation_status! } });
export function createInspectionChannel(driver: TransactionDriver) {
  function read<T>(tenant: string, work: (db: SqlConnection) => Promise<T>): Promise<T> {
    if (!sandboxIdentifier.test(tenant)) throw new Error('Invalid inspection tenant');
    return driver.transaction(async (db) => {
      // The driver begins the transaction; this sets its mode before any read.
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await db.query('SET LOCAL ROLE nazir_inspector');
      await db.query("SELECT set_config('app.inspect_tenant',$1,true)", [tenant]);
      return work(db);
    });
  }
  async function cases(db: SqlConnection, tenant: string) {
    return (await db.query<CaseRow>(caseQuery + ' WHERE c.tenant=$1 ORDER BY c.reference,c.id', [tenant])).rows.map(caseObject);
  }
  async function receipts(db: SqlConnection, tenant: string, filter: { sinceId?: string; since?: string; limit: number | null }) {
    if ((filter.limit !== null && (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > 10000)) || (filter.since && filter.sinceId)) throw new Error('Invalid receipt filter');
    if (filter.sinceId && !/^[a-f0-9-]{36}$/i.test(filter.sinceId)) throw new Error('Invalid receipt cursor');
    if (filter.since && !Number.isFinite(Date.parse(filter.since))) throw new Error('Invalid receipt time');
    const rows = await db.query<ReceiptRow>(`SELECT id,tool,outcome,response->>'error' AS error,created_at FROM sandbox.tool_receipts
      WHERE tenant=$1 AND ($2::timestamptz IS NULL OR created_at>$2)
      AND ($3::uuid IS NULL OR (created_at,id)>(SELECT created_at,id FROM sandbox.tool_receipts WHERE tenant=$1 AND id=$3))
      ORDER BY created_at,id LIMIT $4`, [tenant, filter.since ?? null, filter.sinceId ?? null, filter.limit]);
    return rows.rows.map((row): InspectedReceipt => ({ id: row.id, tool: row.tool, outcome: row.outcome, error: row.error, createdAt: iso(row.created_at) }));
  }
  return {
    readCase: (tenant: string, reference: string) => read(tenant, async (db) => {
      const row = (await db.query<CaseRow>(caseQuery + ' WHERE c.tenant=$1 AND c.reference=$2', [tenant, reference])).rows[0];
      return row ? caseObject(row) : null;
    }),
    listCases: (tenant: string) => read(tenant, (db) => cases(db, tenant)),
    readEscalations: (tenant: string, caseId: string) => read(tenant, async (db) => (await db.query<{ id: string; queue: string; status: string }>('SELECT id,queue,status FROM sandbox.escalations WHERE tenant=$1 AND case_id=$2 ORDER BY id', [tenant, caseId])).rows.map((row): InspectedEscalation => ({ id: row.id, queue: row.queue, status: row.status }))),
    readReceipts: (tenant: string, filter: { sinceId?: string; since?: string; limit: number }) => read(tenant, (db) => receipts(db, tenant, filter)),
    snapshot: (tenant: string): Promise<StateReading> => read(tenant, async (db) => ({
      tenant, takenAt: iso((await db.query<{ taken_at: Date | string }>('SELECT transaction_timestamp() AS taken_at')).rows[0]!.taken_at),
      tenantFaults: (await db.query<{ tool: string }>('SELECT tool FROM sandbox.tenant_faults WHERE tenant=$1 ORDER BY tool', [tenant])).rows,
      cases: await cases(db, tenant), receipts: await receipts(db, tenant, { limit: null }),
    })),
  };
}
