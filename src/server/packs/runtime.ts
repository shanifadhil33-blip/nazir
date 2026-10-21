import type { SqlConnection, TransactionDriver } from '../db/driver';
import { hash } from '../../sandbox/demo-rule-pack';
import type { ChatModel, Message } from '../../sandbox/agent';
import type { SandboxContext, ToolResult } from '../../sandbox/tools';
import { runEstateAgent, estateSystemPrompt, estateVersions, type EstateVersion } from '../../sandbox/real-estate/agent';
import { estateToolManifestHash, estateToolNames } from '../../sandbox/real-estate/tools';
import { estatePolicy } from '../../sandbox/real-estate/policy';
import { readEstate, type EstateReading } from '../../sandbox/real-estate/inspect';
import { runEstateChecks } from '../checks/estate-checks';
import { runShopAgent, shopSystemPrompt, shopVersions, type ShopVersion } from '../../sandbox/shop/agent';
import { shopToolManifestHash, shopToolNames } from '../../sandbox/shop/tools';
import { shopPolicy } from '../../sandbox/shop/policy';
import { readShop, type ShopReading } from '../../sandbox/shop/inspect';
import { runShopChecks } from '../checks/shop-checks';
import { runClinicAgent, clinicSystemPrompt, clinicVersions, type ClinicVersion } from '../../sandbox/clinic/agent';
import { clinicToolManifestHash, clinicToolNames } from '../../sandbox/clinic/tools';
import { clinicPolicy } from '../../sandbox/clinic/policy';
import { readClinic, type ClinicReading } from '../../sandbox/clinic/inspect';
import { runClinicChecks } from '../checks/clinic-checks';
import { runSchoolAgent, schoolSystemPrompt, schoolVersions, type SchoolVersion } from '../../sandbox/school/agent';
import { schoolToolManifestHash, schoolToolNames } from '../../sandbox/school/tools';
import { schoolPolicy } from '../../sandbox/school/policy';
import { readSchool, type SchoolReading } from '../../sandbox/school/inspect';
import { runSchoolChecks } from '../checks/school-checks';
import { packById } from './catalog';
import type { FocusPack, InlineCase, PackId } from './schema';

export type PackVersion = { id: string; label: string; kind: 'baseline' | 'planted_fault'; disclosure: { en: string; ar: string }; configHash: string };
export type PackCheck = { id: string; status: 'pass' | 'fail' | 'inconclusive'; evidence: { expected: unknown; observed: unknown } };
type ToolCall = { name: string; arguments: unknown; result: ToolResult };
type Bilingual = { en: string; ar: string };
/** Everything the runner needs to drive one non Government pack: its sandbox, agent versions, reading, record checks and the facts the judge and findings see. */
export type PackRuntime = {
  pack: FocusPack; id: PackId; seed: string; prefix: string;
  versions: readonly PackVersion[]; systemPromptHash: string; toolManifestHash: string; rulesHash: string; toolNames: readonly string[];
  /** Runs inside the fenced worker transaction. */
  prepare(db: SqlConnection, tenant: string, c: InlineCase): Promise<void>;
  run(input: { model: ChatModel; version: PackVersion; messages: Message[]; sandbox: SandboxContext; conversationKey: string }): Promise<{ reply: string; transcript: Message[]; toolCalls: ToolCall[] }>;
  read(driver: TransactionDriver, tenant: string): Promise<unknown>;
  /** True when the tenant holds only its seeded rows and no tool was called yet. */
  clean(reading: unknown, c: InlineCase): boolean;
  checks(input: { scenario: InlineCase; reply: string; reading: unknown }): PackCheck[];
  facts(reading: unknown, c: InlineCase): { judge: unknown; text: Bilingual };
  clause(id: string): Bilingual;
};
const clauseOf = (clauses: readonly { id: string; en: string; ar: string }[]) => (id: string) => { const c = clauses.find((x) => x.id === id) ?? clauses[0]!; return { en: c.en, ar: c.ar }; };
const receiptsText = (r: { tool: string; outcome: string }[]) => ({ en: r.length ? r.map((x, i) => `Receipt ${i + 1}: ${x.tool}, ${x.outcome === 'ok' ? 'succeeded' : 'failed'}.`).join(' ') : 'No tool was called.', ar: r.length ? r.map((x, i) => `الإيصال ${i + 1}: ${x.tool}، ${x.outcome === 'ok' ? 'نجحت' : 'فشلت'}.`).join(' ') : 'لم تستدع أي أداة.' });

const estate: PackRuntime = {
  pack: packById('real_estate')!, id: 'real_estate', seed: 'estate_sandbox', prefix: 're_',
  versions: Object.values(estateVersions), systemPromptHash: hash(estateSystemPrompt), toolManifestHash: estateToolManifestHash(), rulesHash: hash(estatePolicy), toolNames: estateToolNames,
  async prepare(db, tenant, c) {
    await db.query('SELECT sandbox.re_seed_tenant($1)', [tenant]);
    for (const r of c.starting_state.requests) await db.query('SELECT sandbox.re_seed_request($1,$2,$3,$4,$5,$6,$7)', [tenant, c.persona.requester_key, r.kind, r.unit ?? null, r.slot ?? null, r.queue, r.agent_key ?? null]);
  },
  run: ({ version, ...rest }) => runEstateAgent({ ...rest, version: version as EstateVersion }),
  read: readEstate,
  clean(reading, c) { const r = reading as EstateReading; return r.listings.length === 5 && !r.receipts.length && r.requests.filter((x) => x.seeded).length === 1 + c.starting_state.requests.length && r.requests.every((x) => x.seeded); },
  checks: ({ scenario, reply, reading }) => runEstateChecks({ scenario, reply, reading: reading as EstateReading }),
  facts(reading, c) {
    const r = reading as EstateReading; const mine = r.requests.filter((x) => x.requester_key === c.persona.requester_key);
    const judge = { listings: r.listings.map((l) => ({ unit: l.unit, community: l.community, bedrooms: l.bedrooms, rent_aed: l.rent_aed, status: l.status, permit_number: l.permit_number, agent: l.agent_name, brn: l.brn })), requests: mine.map((x) => ({ reference: x.reference, kind: x.kind, unit: x.unit, slot: x.slot, queue: x.queue, status: x.status })), receipts: r.receipts };
    const rec = receiptsText(r.receipts);
    return { judge, text: {
      en: (mine.length ? mine.map((x) => `Request ${x.reference}: ${x.kind}${x.unit ? ` for ${x.unit}` : ''}, queue ${x.queue}, status ${x.status}.`).join(' ') : 'No request recorded for this requester.') + ' ' + rec.en,
      ar: (mine.length ? mine.map((x) => `الطلب ${x.reference}: ${x.kind}${x.unit ? ` للوحدة ${x.unit}` : ''}، القائمة ${x.queue}، الحالة ${x.status}.`).join(' ') : 'لا يوجد طلب مسجل لهذا المستأجر.') + ' ' + rec.ar } };
  },
  clause: clauseOf(estatePolicy.clauses),
};
const shop: PackRuntime = {
  pack: packById('ecommerce')!, id: 'ecommerce', seed: 'shop_sandbox', prefix: 'ec_',
  versions: Object.values(shopVersions), systemPromptHash: hash(shopSystemPrompt), toolManifestHash: shopToolManifestHash(), rulesHash: hash(shopPolicy), toolNames: shopToolNames,
  async prepare(db, tenant) { await db.query('SELECT sandbox.sh_seed_tenant($1)', [tenant]); },
  run: ({ version, ...rest }) => runShopAgent({ ...rest, version: version as ShopVersion }),
  read: readShop,
  clean(reading) { const r = reading as ShopReading; return r.orders.length === 12 && !r.receipts.length && r.requests.every((x) => x.seeded); },
  checks: ({ scenario, reply, reading }) => runShopChecks({ scenario, reply, reading: reading as ShopReading }),
  facts(reading, c) {
    const r = reading as ShopReading; const me = c.persona.requester_key;
    const orders = r.orders.filter((o) => o.customer_key === me); const mine = r.requests.filter((x) => x.customer_key === me);
    const judge = { today: shopPolicy.today, orders: orders.map((o) => ({ reference: o.reference, product: o.product, status: o.status, total_aed: o.total_aed, placed_on: o.placed_on, delivered_on: o.delivered_on, return_until: o.return_until, warranty_until: o.warranty_until, shipment: o.shipment, charges_aed: o.charges })), products: r.products.map((p) => ({ name: p.name, colour: p.colour, price_aed: p.price_aed })), promotions: r.promotions, requests: mine.map((x) => ({ reference: x.reference, kind: x.kind, order: x.order_reference, queue: x.queue, amount_aed: x.amount_aed, status: x.status })), receipts: r.receipts };
    const rec = receiptsText(r.receipts);
    return { judge, text: {
      en: [orders.map((o) => `Order ${o.reference}: ${o.product}, ${o.status}, AED ${o.total_aed}.`).join(' '), mine.length ? mine.map((x) => `Request ${x.reference}: ${x.kind}${x.order_reference ? ` for ${x.order_reference}` : ''}, queue ${x.queue}${x.amount_aed ? `, AED ${x.amount_aed}` : ''}.`).join(' ') : 'No request recorded for this customer.', rec.en].filter(Boolean).join(' '),
      ar: [orders.map((o) => `الطلب ${o.reference}: ${o.product}، ${o.status}، ${o.total_aed} درهم.`).join(' '), mine.length ? mine.map((x) => `الطلب ${x.reference}: ${x.kind}${x.order_reference ? ` للطلب ${x.order_reference}` : ''}، القائمة ${x.queue}${x.amount_aed ? `، ${x.amount_aed} درهم` : ''}.`).join(' ') : 'لا يوجد طلب مسجل لهذا العميل.', rec.ar].filter(Boolean).join(' ') } };
  },
  clause: clauseOf(shopPolicy.clauses),
};
const clinic: PackRuntime = {
  pack: packById('clinics')!, id: 'clinics', seed: 'clinic_sandbox', prefix: 'cl_',
  versions: Object.values(clinicVersions), systemPromptHash: hash(clinicSystemPrompt), toolManifestHash: clinicToolManifestHash(), rulesHash: hash(clinicPolicy), toolNames: clinicToolNames,
  async prepare(db, tenant) { await db.query('SELECT sandbox.cl_seed_tenant($1)', [tenant]); },
  run: ({ version, ...rest }) => runClinicAgent({ ...rest, version: version as ClinicVersion }),
  read: readClinic,
  clean(reading) { const r = reading as ClinicReading; return r.slots.length === 8 && !r.receipts.length && r.requests.every((x) => x.seeded); },
  checks: ({ scenario, reply, reading }) => runClinicChecks({ scenario, reply, reading: reading as ClinicReading }),
  facts(reading, c) {
    const r = reading as ClinicReading; const me = c.persona.requester_key; const p = r.patients.find((x) => x.patient_key === me);
    const mine = r.requests.filter((x) => x.patient_key === me);
    const judge = { emergency_number: clinicPolicy.emergency_number, doctors: r.doctors.map((d) => ({ name: d.name, clinic: d.clinic, on_leave: d.on_leave })), slots: r.slots.map((s) => ({ slot: s.slot, doctor: s.doctor, day: s.day, time: s.time, status: s.on_leave ? 'blocked' : s.status })), fees: r.fees, coverage: r.coverage.filter((x) => x.insurer === p?.insurer), lab_released: p?.lab_released ?? false, requests: mine.map((x) => ({ reference: x.reference, kind: x.kind, slot: x.slot, queue: x.queue, status: x.status })), receipts: r.receipts };
    const rec = receiptsText(r.receipts);
    return { judge, text: {
      en: (mine.length ? mine.map((x) => `Request ${x.reference}: ${x.kind}${x.slot ? ` for ${x.slot}` : ''}, queue ${x.queue}, status ${x.status}.`).join(' ') : 'No request recorded for this patient.') + ' ' + rec.en,
      ar: (mine.length ? mine.map((x) => `الطلب ${x.reference}: ${x.kind}${x.slot ? ` للموعد ${x.slot}` : ''}، القائمة ${x.queue}، الحالة ${x.status}.`).join(' ') : 'لا يوجد طلب مسجل لهذا المريض.') + ' ' + rec.ar } };
  },
  clause: clauseOf(clinicPolicy.clauses),
};
const school: PackRuntime = {
  pack: packById('schools')!, id: 'schools', seed: 'school_sandbox', prefix: 'sc_',
  versions: Object.values(schoolVersions), systemPromptHash: hash(schoolSystemPrompt), toolManifestHash: schoolToolManifestHash(), rulesHash: hash(schoolPolicy), toolNames: schoolToolNames,
  async prepare(db, tenant) { await db.query('SELECT sandbox.sc_seed_tenant($1)', [tenant]); },
  run: ({ version, ...rest }) => runSchoolAgent({ ...rest, version: version as SchoolVersion }),
  read: readSchool,
  clean(reading) { const r = reading as SchoolReading; return r.students.length === 12 && r.grades.length === 6 && r.calendar.length === 4 && !r.receipts.length && r.requests.every((x) => x.seeded); },
  checks: ({ scenario, reply, reading }) => runSchoolChecks({ scenario, reply, reading: reading as SchoolReading }),
  facts(reading, c) {
    const r = reading as SchoolReading; const me = c.persona.requester_key;
    const mine = r.requests.filter((x) => x.guardian_key === me);
    const judge = { guardian: r.guardians.find((x) => x.guardian_key === me), students: r.students.filter((x) => x.guardian_key === me), grades: r.grades, calendar: r.calendar, bus_fee_aed: schoolPolicy.bus_fee_aed, late_fee_aed: schoolPolicy.late_fee_aed, requests: mine, receipts: r.receipts };
    const rec = receiptsText(r.receipts);
    return { judge, text: {
      en: (mine.length ? mine.map((x) => `Request ${x.reference}: ${x.kind}, queue ${x.queue}, status ${x.status}.`).join(' ') : 'No request recorded for this guardian.') + ' ' + rec.en,
      ar: (mine.length ? mine.map((x) => `الطلب ${x.reference}: ${x.kind}، القائمة ${x.queue}، الحالة ${x.status}.`).join(' ') : 'لا يوجد طلب مسجل لولي الأمر.') + ' ' + rec.ar } };
  },
  clause: clauseOf(schoolPolicy.clauses),
};
export const packRuntimes: readonly PackRuntime[] = [estate, shop, clinic, school];
export const runtimeForSeed = (state: unknown) => { const seed = (state as { seed?: unknown } | null)?.seed; return packRuntimes.find((r) => r.seed === seed) ?? null; };
export const runtimeForPack = (id: string) => packRuntimes.find((r) => r.id === id) ?? null;
/** A pack agent version is referenced by registry id plus its pinned hash, so a changed prompt or tool list reads as drift. */
export function resolvePackVersion(config: { registry_id?: string; pack_config_hash?: string } | null | undefined) {
  if (!config?.registry_id) return null;
  for (const r of packRuntimes) { const v = r.versions.find((x) => x.id === config.registry_id); if (v) return config.pack_config_hash === undefined || config.pack_config_hash === v.configHash ? { runtime: r, version: v } : null; }
  return null;
}
/** The scenario row, read back as the pack case it was imported from. */
export function caseFromRow(row: Record<string, unknown>): InlineCase {
  const persona = row.persona as { requester_key: string; name: string; resident_turns: string[] };
  const canonical = (row.canonical ?? {}) as { kind?: 'normal' | 'trap' };
  return { stable_key: String(row.stable_key), family: String(row.family), kind: canonical.kind ?? 'normal', language: row.language as 'en' | 'ar', persona: { requester_key: persona.requester_key, name: persona.name, synthetic: true }, resident_turns: persona.resident_turns, starting_state: row.starting_state as InlineCase['starting_state'], expected: row.expected_state as InlineCase['expected'], checks: row.checks as string[], severity: row.severity as InlineCase['severity'], source_clause: String(row.source_clause) };
}
