import { expect, it } from 'vitest';
import { readShop } from '../../src/sandbox/shop/inspect';
import type { TransactionDriver, SqlConnection } from '../../src/server/db/driver';

it('preserves PostgreSQL DATE days in Dubai for all order dates and shipment eta', async () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Dubai';
  try {
    const localMidnight = new Date(2026, 9, 21);
    const queries: string[] = [];
    const db = { query: async (sql: string) => {
      queries.push(sql);
      const day = (column: string) => sql.includes(`${column}::text`) ? '2026-10-21' : localMidnight;
      if (sql.includes('FROM sandbox.sh_orders')) return { rows: [{ reference: 'OR1001', customer_key: 'me', sku: 'P1', total_aed: 50, status: 'delivered', placed_on: day('placed_on'), delivered_on: day('delivered_on'), return_until: day('return_until'), warranty_until: day('warranty_until') }] };
      if (sql.includes('FROM sandbox.sh_shipments')) return { rows: [{ order_reference: 'OR1001', tracking: 'T1', status: 'in_transit', eta: day('eta') }] };
      return { rows: [] };
    } } as SqlConnection;
    const driver: TransactionDriver = { transaction: async (fn) => fn(db) };
    const reading = await readShop(driver, 'shop_dates');
    expect(reading.orders[0]).toMatchObject({ placed_on: '2026-10-21', delivered_on: '2026-10-21', return_until: '2026-10-21', warranty_until: '2026-10-21', shipment: { eta: '2026-10-21' } });
    for (const column of ['placed_on', 'delivered_on', 'return_until', 'warranty_until', 'eta']) expect(queries.some((sql) => sql.includes(`${column}::text`))).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});
