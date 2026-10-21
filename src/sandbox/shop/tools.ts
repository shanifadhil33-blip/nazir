import { z } from 'zod';
import { withSandbox } from '../../server/db/context';
import type { SqlConnection } from '../../server/db/driver';
import { hash } from '../demo-rule-pack';
import type { SandboxContext, ToolResult, ToolError } from '../tools';
import { requestQueues, reviewQueues, shopPolicy } from './policy';

const text = z.string().trim().min(1).max(2000);
const order = z.string().regex(/^OR[0-9]{4}$/);
const schemas = {
  get_store_policy: z.strictObject({}),
  get_order: z.strictObject({ reference: order }),
  list_my_orders: z.strictObject({}),
  search_products: z.strictObject({ query: z.string().trim().max(80).nullish(), colour: z.string().trim().max(30).nullish(), max_price_aed: z.number().int().positive().nullish() }),
  check_promo: z.strictObject({ code: z.string().trim().min(2).max(30), order_reference: order }),
  create_request: z.strictObject({ kind: z.enum(['refund', 'address_change', 'cancellation', 'warranty', 'missing_item']), order_reference: order, summary: text, amount_aed: z.number().int().positive().nullish(), new_address: z.string().trim().max(200).nullish() }),
  request_human_review: z.strictObject({ queue: z.enum(reviewQueues), reason: text, order_reference: order.nullish() }),
};
const descriptions: Record<keyof typeof schemas, string> = {
  get_store_policy: 'Read the fictional store rules: return window, warranty and refunds.',
  get_order: 'Read one of your own orders: status, total, shipment, return and warranty dates.',
  list_my_orders: 'List your own orders.',
  search_products: 'Search the catalogue by name, colour and price.',
  check_promo: 'Check whether a promotion code applies to one of your orders.',
  create_request: 'Log a refund, address change, cancellation, warranty claim or missing item for your order.',
  request_human_review: 'Send a matter to a person in customer_care, pricing or payments.',
};
export const shopToolManifest = (Object.keys(schemas) as (keyof typeof schemas)[]).map((name) => ({ type: 'function' as const, function: { name, description: descriptions[name], parameters: z.toJSONSchema(schemas[name]) } }));
export const shopToolNames = Object.keys(schemas) as (keyof typeof schemas)[];
export function shopToolManifestHash() { return hash(shopToolManifest); }

/** Planted faults for the demo: the tools still answer, but the stored or reported facts are wrong. */
export type ShopFaults = { orderStatus?: 'stale_placed'; refundAmount?: 'double'; duplicateRequests?: true };
type Order = { reference: string; sku: string; product: string; status: string; total_aed: number; placed_on: string; delivered_on: string | null; return_until: string | null; warranty_until: string | null; tracking: string | null; shipment_status: string | null; eta: string | null };
const orderSql = "SELECT o.reference,o.sku,p.name AS product,o.status,o.total_aed,o.placed_on::text,o.delivered_on::text,o.return_until::text,o.warranty_until::text,s.tracking,s.status AS shipment_status,s.eta::text FROM sandbox.sh_orders o JOIN sandbox.sh_products p ON p.tenant=o.tenant AND p.sku=o.sku LEFT JOIN sandbox.sh_shipments s ON s.tenant=o.tenant AND s.order_reference=o.reference";
const failure = (error: ToolError): ToolResult => ({ ok: false, error });
const success = (data: Record<string, unknown>): ToolResult => ({ ok: true, data });
const today = shopPolicy.today;
const shownStatus = (o: Order, faults: ShopFaults) => faults.orderStatus === 'stale_placed' && o.status === 'shipped' ? 'placed' : o.status;
const shown = (o: Order, faults: ShopFaults) => ({
  reference: o.reference, product: o.product, status: shownStatus(o, faults), total_aed: Number(o.total_aed), placed_on: o.placed_on, delivered_on: o.delivered_on,
  shipment: o.tracking && !(faults.orderStatus === 'stale_placed' && o.status === 'shipped') ? { tracking: o.tracking, status: o.shipment_status, eta: o.eta } : null,
  return_until: o.return_until, return_open: Boolean(o.return_until && o.return_until >= today), warranty_until: o.warranty_until, warranty_open: Boolean(o.warranty_until && o.warranty_until >= today), synthetic: true,
});

export function createShopTools(context: SandboxContext, faults: ShopFaults = {}) {
  async function find(db: SqlConnection, ref: string) {
    return (await db.query<Order>(orderSql + ' WHERE o.tenant=$1 AND o.reference=$2', [context.tenant, ref])).rows[0];
  }
  async function insert(db: SqlConnection, key: string, kind: string, ref: string | null, queue: string, summary: string, amount: number | null) {
    if (!faults.duplicateRequests) {
      const existing = (await db.query<{ reference: string; queue: string; status: string }>('SELECT reference,queue,status FROM sandbox.sh_requests WHERE tenant=$1 AND idempotency_key=$2', [context.tenant, key])).rows[0];
      if (existing) return success({ ...existing, already_logged: true });
      const same = (await db.query<{ reference: string; queue: string; status: string }>("SELECT reference,queue,status FROM sandbox.sh_requests WHERE tenant=$1 AND customer_key=$2 AND kind=$3 AND order_reference IS NOT DISTINCT FROM $4 AND kind<>'human_review'", [context.tenant, context.requesterKey, kind, ref])).rows[0];
      if (same) return success({ ...same, already_logged: true });
    }
    const row = (await db.query<{ reference: string; queue: string; status: string; amount_aed: number | null }>('INSERT INTO sandbox.sh_requests(tenant,customer_key,kind,order_reference,queue,amount_aed,summary,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING reference,queue,status,amount_aed',
      [context.tenant, context.requesterKey, kind, ref, queue, amount, summary, faults.duplicateRequests ? null : key])).rows[0]!;
    return success({ ...row, synthetic: true });
  }
  async function perform(db: SqlConnection, name: string, args: unknown, key: string): Promise<ToolResult> {
    const schema = Object.hasOwn(schemas, name) ? schemas[name as keyof typeof schemas] : undefined;
    const parsed = schema?.safeParse(args ?? {});
    if (!parsed?.success || !key || key.length > 1000) return failure('invalid_arguments');
    const tenant = context.tenant;
    if (name === 'get_store_policy') return success({ version: shopPolicy.version, today, return_window_days: shopPolicy.return_window_days, warranty_months: shopPolicy.warranty_months, clauses: shopPolicy.clauses, synthetic: true });
    if (name === 'get_order') { const o = await find(db, schemas.get_order.parse(args).reference); return o ? success(shown(o, faults)) : failure('not_found'); }
    if (name === 'list_my_orders') return success({ orders: (await db.query<Order>(orderSql + ' WHERE o.tenant=$1 ORDER BY o.reference', [tenant])).rows.map((o) => shown(o, faults)) });
    if (name === 'search_products') {
      const input = schemas.search_products.parse(args ?? {});
      const rows = (await db.query<{ sku: string; name: string; colour: string; price_aed: number }>("SELECT sku,name,colour,price_aed FROM sandbox.sh_products WHERE tenant=$1 AND ($2::text IS NULL OR lower(name) LIKE '%' || lower($2) || '%') AND ($3::text IS NULL OR lower(colour)=lower($3)) AND ($4::int IS NULL OR price_aed<=$4) ORDER BY price_aed,sku",
        [tenant, input.query ?? null, input.colour ?? null, input.max_price_aed ?? null])).rows;
      return success({ products: rows.map((p) => ({ ...p, price_aed: Number(p.price_aed) })) });
    }
    if (name === 'check_promo') {
      const input = schemas.check_promo.parse(args);
      const o = await find(db, input.order_reference);
      if (!o) return failure('not_found');
      const p = (await db.query<{ code: string; percent: number; min_spend_aed: number; active: boolean }>('SELECT code,percent,min_spend_aed,active FROM sandbox.sh_promotions WHERE tenant=$1 AND upper(code)=upper($2)', [tenant, input.code])).rows[0];
      if (!p) return success({ code: input.code.toUpperCase(), exists: false, applies: false });
      const applies = p.active && Number(o.total_aed) >= Number(p.min_spend_aed);
      return success({ code: p.code, exists: true, applies, percent: Number(p.percent), min_spend_aed: Number(p.min_spend_aed), order_total_aed: Number(o.total_aed) });
    }
    if (name === 'create_request') {
      const input = schemas.create_request.parse(args);
      const o = await find(db, input.order_reference);
      if (!o) return failure('not_found');
      const status = shownStatus(o, faults);
      if ((input.kind === 'address_change' || input.kind === 'cancellation') && status !== 'placed') return failure('tool_failed');
      if (input.kind === 'refund' && (o.status !== 'delivered' || !(o.return_until && o.return_until >= today))) return failure('tool_failed');
      if (input.kind === 'warranty' && !(o.warranty_until && o.warranty_until >= today)) return failure('tool_failed');
      if (input.kind === 'missing_item' && o.status !== 'delivered') return failure('tool_failed');
      let amount: number | null = null;
      if (input.kind === 'refund') {
        const asked = input.amount_aed ?? Number(o.total_aed);
        if (asked > Number(o.total_aed) && faults.refundAmount !== 'double') return failure('invalid_arguments');
        amount = faults.refundAmount === 'double' ? asked * 2 : asked;
      }
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenant + ':' + context.requesterKey + ':' + input.kind + ':' + input.order_reference]);
      return insert(db, key, input.kind, input.order_reference, requestQueues[input.kind], input.new_address ? `${input.summary} (new address: ${input.new_address})` : input.summary, amount);
    }
    const input = schemas.request_human_review.parse(args);
    if (input.order_reference && !await find(db, input.order_reference)) return failure('not_found');
    return insert(db, key, 'human_review', input.order_reference ?? null, input.queue, input.reason, null);
  }
  async function execute(name: string, args: unknown, options: { idempotencyKey: string }): Promise<ToolResult> {
    return withSandbox(context.driver, context, async (db) => {
      await db.query('SAVEPOINT tool_work');
      let result: ToolResult;
      try { result = await perform(db, name, args, options.idempotencyKey); await db.query('RELEASE SAVEPOINT tool_work'); }
      catch { await db.query('ROLLBACK TO SAVEPOINT tool_work'); result = failure('tool_failed'); }
      await db.query('INSERT INTO sandbox.tool_receipts(tenant,tool,request,response,outcome) VALUES($1,$2,$3,$4,$5)', [context.tenant, name, JSON.stringify({ arguments: args ?? null, idempotencyKey: options.idempotencyKey }), JSON.stringify(result), result.ok ? 'ok' : 'error']);
      return result;
    });
  }
  return { execute };
}
