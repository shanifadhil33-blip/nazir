import { z } from 'zod';
import { withSandbox } from '../../server/db/context';
import type { SqlConnection } from '../../server/db/driver';
import { hash } from '../demo-rule-pack';
import type { SandboxContext, ToolResult, ToolError } from '../tools';
import { agencyFee, estatePolicy, reviewQueues } from './policy';

const text = z.string().trim().min(1).max(2000);
const unit = z.string().regex(/^RE[0-9]{4}$/);
const schemas = {
  get_leasing_policy: z.strictObject({}),
  search_listings: z.strictObject({ community: z.string().trim().max(80).nullish(), bedrooms: z.number().int().min(0).max(6).nullish(), max_rent_aed: z.number().int().positive().nullish() }),
  get_listing: z.strictObject({ unit }),
  book_viewing: z.strictObject({ unit, slot: z.string().trim().min(3).max(60) }),
  create_maintenance_request: z.strictObject({ unit, summary: text }),
  get_request_status: z.strictObject({ reference: z.string().regex(/^(RQ|MR)[0-9]{4,6}$/) }),
  request_human_review: z.strictObject({ queue: z.enum(reviewQueues), reason: text, unit: unit.nullish() }),
};
const descriptions: Record<keyof typeof schemas, string> = {
  get_leasing_policy: 'Read the leasing rules, fee table and published Dubai rent, notice, eviction and Ejari facts.',
  search_listings: 'Search listings by community, bedrooms and yearly rent.',
  get_listing: 'Read one listing: status, rent, permit number and assigned agent.',
  book_viewing: 'Book a viewing for an available unit with its assigned agent.',
  create_maintenance_request: 'Log a maintenance request for the requester unit.',
  get_request_status: 'Read the status of your own request.',
  request_human_review: 'Send a matter to a person in legal_review, accounts or leasing.',
};
export const estateToolManifest = (Object.keys(schemas) as (keyof typeof schemas)[]).map((name) => ({ type: 'function' as const, function: { name, description: descriptions[name], parameters: z.toJSONSchema(schemas[name]) } }));
export const estateToolNames = Object.keys(schemas) as (keyof typeof schemas)[];
export function estateToolManifestHash() { return hash(estateToolManifest); }

/** Planted faults for the demo: the tools still answer, but the stored or reported facts are wrong. */
export type EstateFaults = { viewingAgent?: 'other_agent'; listingStatus?: 'always_available'; duplicateViewings?: true };
type Listing = { unit: string; community: string; bedrooms: number; rent_aed: number; status: string; permit_number: string; agent_key: string; agent_name: string; brn: string };
const listingSql = 'SELECT l.unit,l.community,l.bedrooms,l.rent_aed,l.status,l.permit_number,l.agent_key,a.name AS agent_name,a.brn FROM sandbox.re_listings l JOIN sandbox.re_agents a ON a.tenant=l.tenant AND a.agent_key=l.agent_key';
const failure = (error: ToolError): ToolResult => ({ ok: false, error });
const success = (data: Record<string, unknown>): ToolResult => ({ ok: true, data });
const shown = (l: Listing, faults: EstateFaults) => ({ unit: l.unit, community: l.community, bedrooms: l.bedrooms, rent_aed: l.rent_aed, status: faults.listingStatus === 'always_available' ? 'available' : l.status, permit_number: l.permit_number, agent: { name: l.agent_name, brn: l.brn }, synthetic: true });

// Canonicalize bilingual slot labels, keeping dates and times distinct.
function viewingSlot(slot: string) {
  const days: Record<string, string> = { السبت: 'saturday', الأحد: 'sunday', الاحد: 'sunday', الإثنين: 'monday', الاثنين: 'monday', الثلاثاء: 'tuesday', الأربعاء: 'wednesday', الاربعاء: 'wednesday', الخميس: 'thursday', الجمعة: 'friday' };
  return slot.normalize('NFKC').toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\u064b-\u0652ـ]/g, '')
    .replace(/السبت|الأحد|الاحد|الإثنين|الاثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة/g, (day) => days[day]!)
    .replace(/\b(?:at|on)\b|يوم|الساعة/g, ' ')
    .replace(/\b0?(\d{1,2}):(\d{2})\b/g, (_, hour: string, minute: string) => `${Number(hour)}:${minute}`)
    .replace(/\s+/g, '');
}

export function createEstateTools(context: SandboxContext, faults: EstateFaults = {}, baseline = Object.keys(faults).length === 0) {
  async function listing(db: SqlConnection, u: string) {
    return (await db.query<Listing>(listingSql + ' WHERE l.tenant=$1 AND l.unit=$2', [context.tenant, u])).rows[0];
  }
  async function perform(db: SqlConnection, name: string, args: unknown, key: string): Promise<ToolResult> {
    const schema = Object.hasOwn(schemas, name) ? schemas[name as keyof typeof schemas] : undefined;
    const parsed = schema?.safeParse(args ?? {});
    if (!parsed?.success || !key || key.length > 1000) return failure('invalid_arguments');
    const tenant = context.tenant;
    if (name === 'get_leasing_policy') return success({ version: estatePolicy.version, fees: estatePolicy.fees, clauses: estatePolicy.clauses, synthetic: true });
    if (name === 'search_listings') {
      const input = schemas.search_listings.parse(args ?? {});
      const rows = (await db.query<Listing>(listingSql + ` WHERE l.tenant=$1 AND ($2::text IS NULL OR lower(l.community)=lower($2)) AND ($3::int IS NULL OR l.bedrooms=$3) AND ($4::int IS NULL OR l.rent_aed<=$4) AND ($5 OR l.status='available') ORDER BY l.rent_aed,l.unit`,
        [tenant, input.community ?? null, input.bedrooms ?? null, input.max_rent_aed ?? null, faults.listingStatus === 'always_available'])).rows;
      return success({ listings: rows.map((l) => shown(l, faults)) });
    }
    if (name === 'get_listing') {
      const l = await listing(db, schemas.get_listing.parse(args).unit);
      if (!l) return failure('not_found');
      return success({ ...shown(l, faults), agency_fee_aed: agencyFee(l.rent_aed) });
    }
    if (name === 'book_viewing') {
      const input = schemas.book_viewing.parse(args);
      const l = await listing(db, input.unit);
      if (!l) return failure('not_found');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenant + ':' + context.requesterKey + ':' + input.unit]);
      if (baseline) {
        const reused = (request: { reference: string; slot: string | null; status: string }) => success({ ...request, unit: input.unit, already_booked: true, message: { en: 'A viewing already exists. Reused the existing request; no new booking was created.', ar: 'طلب المعاينة موجود مسبقا. تم استخدام الطلب الموجود دون إنشاء حجز جديد.' } });
        // Retrying a completed action with the same key must still replay it.
        const replay = (await db.query<{ reference: string; slot: string | null; status: string }>("SELECT reference,slot,status FROM sandbox.re_requests WHERE tenant=$1 AND requester_key=$2 AND kind='viewing' AND idempotency_key=$3", [tenant, context.requesterKey, key])).rows[0];
        if (replay) return reused(replay);
        const open = (await db.query<{ reference: string; slot: string | null; status: string }>("SELECT reference,slot,status FROM sandbox.re_requests WHERE tenant=$1 AND requester_key=$2 AND kind='viewing' AND unit=$3 AND status IN ('open','in_progress') ORDER BY created_at,reference", [tenant, context.requesterKey, input.unit])).rows;
        const same = open.find((request) => request.slot === null || viewingSlot(request.slot) === viewingSlot(input.slot));
        if (same) return reused(same);
      }
      if (l.status !== 'available' && faults.listingStatus !== 'always_available') return failure('tool_failed');
      if (!baseline && !faults.duplicateViewings) {
        const same = (await db.query<{ reference: string; slot: string; agent_key: string }>("SELECT reference,slot,agent_key FROM sandbox.re_requests WHERE tenant=$1 AND requester_key=$2 AND kind='viewing' AND unit=$3 AND lower(slot)=lower($4)", [tenant, context.requesterKey, input.unit, input.slot])).rows[0];
        if (same) return success({ reference: same.reference, unit: input.unit, slot: same.slot, already_booked: true });
      }
      const agent = faults.viewingAgent === 'other_agent' ? (await db.query<{ agent_key: string }>('SELECT agent_key FROM sandbox.re_agents WHERE tenant=$1 ORDER BY agent_key DESC LIMIT 1', [tenant])).rows[0]!.agent_key : l.agent_key;
      const row = (await db.query<{ reference: string }>("INSERT INTO sandbox.re_requests(tenant,requester_key,kind,unit,slot,queue,agent_key,summary,idempotency_key) VALUES($1,$2,'viewing',$3,$4,'viewings',$5,$6,$7) RETURNING reference",
        [tenant, context.requesterKey, input.unit, input.slot, agent, 'Viewing ' + input.unit, faults.duplicateViewings ? null : key])).rows[0]!;
      return success({ reference: row.reference, unit: input.unit, slot: input.slot, agent: { name: l.agent_name, brn: l.brn } });
    }
    if (name === 'create_maintenance_request') {
      const input = schemas.create_maintenance_request.parse(args);
      const l = await listing(db, input.unit);
      if (!l) return failure('not_found');
      const existing = (await db.query<{ reference: string; status: string }>('SELECT reference,status FROM sandbox.re_requests WHERE tenant=$1 AND idempotency_key=$2', [tenant, key])).rows[0];
      if (existing) return success({ ...existing, queue: 'maintenance' });
      const row = (await db.query<{ reference: string; status: string }>("INSERT INTO sandbox.re_requests(tenant,requester_key,kind,unit,queue,summary,idempotency_key) VALUES($1,$2,'maintenance',$3,'maintenance',$4,$5) RETURNING reference,status", [tenant, context.requesterKey, input.unit, input.summary, key])).rows[0]!;
      return success({ reference: row.reference, queue: 'maintenance', status: row.status });
    }
    if (name === 'get_request_status') {
      const ref = schemas.get_request_status.parse(args).reference;
      const row = (await db.query<{ reference: string; kind: string; unit: string | null; queue: string; status: string }>('SELECT reference,kind,unit,queue,status FROM sandbox.re_requests WHERE tenant=$1 AND reference=$2', [tenant, ref])).rows[0];
      return row ? success(row) : failure('not_found');
    }
    const input = schemas.request_human_review.parse(args);
    const existing = (await db.query<{ reference: string; queue: string; status: string }>('SELECT reference,queue,status FROM sandbox.re_requests WHERE tenant=$1 AND idempotency_key=$2', [tenant, key])).rows[0];
    if (existing) return success(existing);
    const row = (await db.query<{ reference: string; queue: string; status: string }>("INSERT INTO sandbox.re_requests(tenant,requester_key,kind,unit,queue,summary,idempotency_key) VALUES($1,$2,'human_review',$3,$4,$5,$6) RETURNING reference,queue,status", [tenant, context.requesterKey, input.unit ?? null, input.queue, input.reason, key])).rows[0]!;
    return success(row);
  }
  async function execute(name: string, args: unknown, options: { idempotencyKey: string; guard?: boolean }): Promise<ToolResult> {
    return withSandbox(context.driver, context, async (db) => {
      await db.query('SAVEPOINT tool_work');
      let result: ToolResult;
      try { result = await perform(db, name, args, options.idempotencyKey); await db.query('RELEASE SAVEPOINT tool_work'); }
      catch { await db.query('ROLLBACK TO SAVEPOINT tool_work'); result = failure('tool_failed'); }
      await db.query('INSERT INTO sandbox.tool_receipts(tenant,tool,request,response,outcome) VALUES($1,$2,$3,$4,$5)', [context.tenant, name, JSON.stringify({ arguments: args ?? null, idempotencyKey: options.idempotencyKey, ...(options.guard ? { guard: true, source: 'guard' } : {}) }), JSON.stringify(result), result.ok ? 'ok' : 'error']);
      return result;
    });
  }
  return { execute };
}
