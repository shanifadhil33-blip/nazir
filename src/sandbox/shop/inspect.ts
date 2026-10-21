import { sandboxIdentifier } from '../../server/db/context';
import type { TransactionDriver } from '../../server/db/driver';

export type ShopOrder = { reference: string; customer_key: string; sku: string; product: string; status: 'placed' | 'shipped' | 'delivered' | 'cancelled'; total_aed: number; placed_on: string; delivered_on: string | null; return_until: string | null; warranty_until: string | null; shipment: { tracking: string; status: string; eta: string | null } | null; charges: number[] };
export type ShopRequest = { reference: string; customer_key: string; kind: string; order_reference: string | null; queue: string; amount_aed: number | null; status: string; seeded: boolean };
export type ShopReading = { tenant: string; orders: ShopOrder[]; products: { sku: string; name: string; name_ar: string; colour: string; price_aed: number }[]; promotions: { code: string; percent: number; min_spend_aed: number; active: boolean }[]; requests: ShopRequest[]; customers: { customer_key: string; name: string; phone: string; address: string; card_last4: string }[]; receipts: { tool: string; outcome: 'ok' | 'error' }[] };
const day = (d: unknown) => d === null || d === undefined ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

/** Read only snapshot through the inspector role. */
export async function readShop(driver: TransactionDriver, tenant: string): Promise<ShopReading> {
  if (!sandboxIdentifier.test(tenant)) throw new Error('Invalid inspection tenant');
  return driver.transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    await db.query('SET LOCAL ROLE nazir_inspector');
    await db.query("SELECT set_config('app.inspect_tenant',$1,true)", [tenant]);
    const products = (await db.query<ShopReading['products'][number]>('SELECT sku,name,name_ar,colour,price_aed FROM sandbox.sh_products WHERE tenant=$1 ORDER BY sku', [tenant])).rows.map((p) => ({ ...p, price_aed: Number(p.price_aed) }));
    const ships = (await db.query<{ order_reference: string; tracking: string; status: string; eta: unknown }>('SELECT order_reference,tracking,status,eta FROM sandbox.sh_shipments WHERE tenant=$1', [tenant])).rows;
    const charges = (await db.query<{ order_reference: string; amount_aed: number }>('SELECT order_reference,amount_aed FROM sandbox.sh_charges WHERE tenant=$1 ORDER BY seq', [tenant])).rows;
    const orders = (await db.query<Record<string, unknown>>('SELECT reference,customer_key,sku,status,total_aed,placed_on,delivered_on,return_until,warranty_until FROM sandbox.sh_orders WHERE tenant=$1 ORDER BY reference', [tenant])).rows.map((o) => {
      const s = ships.find((x) => x.order_reference === o.reference);
      return { reference: String(o.reference), customer_key: String(o.customer_key), sku: String(o.sku), product: products.find((p) => p.sku === o.sku)?.name ?? String(o.sku), status: o.status as ShopOrder['status'], total_aed: Number(o.total_aed), placed_on: day(o.placed_on)!, delivered_on: day(o.delivered_on), return_until: day(o.return_until), warranty_until: day(o.warranty_until), shipment: s ? { tracking: s.tracking, status: s.status, eta: day(s.eta) } : null, charges: charges.filter((c) => c.order_reference === o.reference).map((c) => Number(c.amount_aed)) };
    });
    const promotions = (await db.query<ShopReading['promotions'][number]>('SELECT code,percent,min_spend_aed,active FROM sandbox.sh_promotions WHERE tenant=$1 ORDER BY code', [tenant])).rows.map((p) => ({ ...p, percent: Number(p.percent), min_spend_aed: Number(p.min_spend_aed) }));
    const requests = (await db.query<ShopRequest>('SELECT reference,customer_key,kind,order_reference,queue,amount_aed,status,seeded FROM sandbox.sh_requests WHERE tenant=$1 ORDER BY created_at,reference', [tenant])).rows.map((r) => ({ ...r, amount_aed: r.amount_aed === null ? null : Number(r.amount_aed) }));
    const customers = (await db.query<ShopReading['customers'][number]>('SELECT customer_key,name,phone,address,card_last4 FROM sandbox.sh_customers WHERE tenant=$1 ORDER BY customer_key', [tenant])).rows;
    const receipts = (await db.query<{ tool: string; outcome: 'ok' | 'error' }>('SELECT tool,outcome FROM sandbox.tool_receipts WHERE tenant=$1 ORDER BY created_at,id', [tenant])).rows;
    return { tenant, orders, products, promotions, requests, customers, receipts };
  });
}
