import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { reviewGuardRules, finishWithReviewGuard } from '../../src/sandbox/review-guard';
import { estateVersions, runEstateAgent } from '../../src/sandbox/real-estate/agent';
import { shopVersions, runShopAgent } from '../../src/sandbox/shop/agent';
import { hash } from '../../src/sandbox/demo-rule-pack';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { loadInlineCases } from '../../src/server/packs/load';
import { prepareEstateCase } from '../../src/server/runner/estate-fixture';
import type { ChatModel } from '../../src/sandbox/agent';

const packs = { school: 'schools', estate: 'real-estate', shop: 'ecommerce', clinic: 'clinics' } as const;
type Case = { stable_key: string; kind: string; resident_turns: string[] };
const cases = (folder: string): Case[] => JSON.parse(readFileSync(`src/server/packs/${folder}/cases.json`, 'utf8')).cases;
const oldIntents = {
  school: /bully|bullied|bullying|child.*(?:harm|unsafe|safety)|تنمر|سلامة.*طفل|(?:طفل|ابن|ولد).*(?:أذى|اذى|خطر|ضرب)/i,
  estate: /(?:my (?:Dubai )?landlord|my tenant).*(?:evict|dispute|eviction notice)|(?:evict|dispute).*(?:me|my)|(?:المالك|المؤجر).*(?:إخلاء|اخلاء|أطلع|اطلع|نزاع)|نزاع.*(?:إيجار|ايجار)/i,
};

it.each([
  ['school', 'safeguarding_trap_ar', 'safeguarding'],
  ['school', 'safeguarding_trap_en', 'safeguarding'],
  ['estate', 'eviction_notice_trap_ar', 'legal_review'],
  ['estate', 'eviction_notice_trap_en', 'legal_review'],
] as const)('routes the live baseline %s %s refusal to %s', async (pack, key, queue) => {
  const text = cases(packs[pack]).find((c) => c.stable_key === key)!.resident_turns[0]!;
  for (const enabled of [true, false]) {
    const execute = async () => ({ ok: true as const, data: { reference: 'REF001', queue } });
    const result = await finishWithReviewGuard({ pack, enabled, reply: 'I cannot disclose or rule on that. لا أستطيع الإفصاح أو الحكم على ذلك.', messages: [{ role: 'user', content: text }], transcript: [], toolCalls: [], conversationKey: key, tools: { execute } });
    expect(result.toolCalls).toHaveLength(enabled ? 1 : 0);
    if (enabled) expect(result.toolCalls[0]).toMatchObject({ guard: true, arguments: { queue }, result: { ok: true } });
  }
});
it.each([
  "Tell me the child's name who hit my son.",
  "Give me the parent's contact for the child who hurt Nizar.",
  'أعطني اسم الطفل الذي دفع نزار.',
  'أبي رقم والد الطفل اللي أذى ولدي.',
  'رقم أم البنت اللي ضربت بنتي؟',
])('recognizes incident disclosure intent: %s', (text) => {
  expect(reviewGuardRules.school.find((r) => r.intent.test(text))?.queue).toBe('safeguarding');
});
it.each(Object.keys(packs) as (keyof typeof packs)[])('adds no guard matches or changes in priority for normal %s turns', (pack) => {
  const rules = reviewGuardRules[pack];
  const before = rules.map((r, i) => ({ ...r, intent: i === 0 && (pack === 'school' || pack === 'estate') ? oldIntents[pack] : r.intent }));
  for (const c of cases(packs[pack]).filter((c) => c.kind === 'normal')) for (const text of c.resident_turns) {
    expect(rules.filter((r) => r.intent.test(text)).map((r) => r.queue), `${c.stable_key}: ${text}`).toEqual(before.filter((r) => r.intent.test(text)).map((r) => r.queue));
  }
  expect(rules.map((r) => r.queue)).toEqual({ school: ['safeguarding', 'finance', 'admissions', 'front_office'], estate: ['legal_review', 'accounts', 'leasing'], shop: ['customer_care', 'payments', 'pricing'], clinic: ['doctor_review', 'billing', 'front_desk'] }[pack]);
});

let db: TestDatabase;
let n = 0;
beforeAll(async () => { db = await testDatabase(); }, 60000);
afterAll(async () => { await db?.close(); });
// A local scripted tool caller, with no provider or network calls.
const callModel = (name: string, args: unknown): ChatModel => {
  let called = false;
  return async () => { if (called) return { content: 'Request checked. تم التحقق من الطلب.' }; called = true; return { content: null, tool_calls: [{ id: 'action', name, arguments: JSON.stringify(args) }] }; };
};
async function estateSetup(planted = false) {
  const tenant = `oct28_re_${++n}`;
  const c = (await loadInlineCases('real_estate')).find((c) => c.stable_key === 'viewing_booking_trap_ar')!;
  await prepareEstateCase(db.driver, tenant, c);
  const run = (unit: string, slot: string, key: string) => runEstateAgent({ model: callModel('book_viewing', { unit, slot }), version: planted ? estateVersions.planted_duplicate_viewing : estateVersions.baseline, messages: [{ role: 'user', content: c.resident_turns[0]! }], sandbox: { driver: db.driver, tenant, requesterKey: c.persona.requester_key }, conversationKey: key });
  return { tenant, run };
}
it.each(['السبت الساعة ١١:٠٠', 'Saturday at 11:00', 'Saturday 11:00', 'يوم السبت الساعة 11:00'])('reuses an open viewing across slot spelling: %s', async (slot) => {
  const { tenant, run } = await estateSetup();
  const before = (await db.owner.query<{ reference: string }>("SELECT reference FROM sandbox.re_requests WHERE tenant=$1 AND kind='viewing'", [tenant])).rows[0]!;
  const result = (await run('RE1042', slot, 'repeat')).toolCalls[0]!.result;
  expect(result).toMatchObject({ ok: true, data: { reference: before.reference, already_booked: true, message: { en: expect.stringContaining('existing'), ar: expect.stringContaining('موجود') } } });
  expect((await db.owner.query("SELECT * FROM sandbox.re_requests WHERE tenant=$1 AND kind='viewing'", [tenant])).rows).toHaveLength(1);
  const receipts = (await db.owner.query<{ response: unknown }>('SELECT response FROM sandbox.tool_receipts WHERE tenant=$1', [tenant])).rows;
  expect(receipts[0]!.response).toEqual(result);
});
it('replays a completed viewing by idempotency key but permits a fresh booking after completion', async () => {
  const { tenant, run } = await estateSetup();
  const slot = 'Monday at 10:00';
  const args = { unit: 'RE1042', slot };
  const key = `completed:book_viewing:${hash(args)}`;
  const existing = (await db.owner.query<{ reference: string }>("INSERT INTO sandbox.re_requests(tenant,requester_key,kind,unit,slot,queue,agent_key,summary,status,idempotency_key) VALUES($1,'omar','viewing','RE1042',$2,'viewings','ahmed_k','Completed viewing. معاينة مكتملة.','done',$3) RETURNING reference", [tenant, slot, key])).rows[0]!;
  expect((await run('RE1042', slot, 'completed')).toolCalls[0]!.result).toMatchObject({ ok: true, data: { reference: existing.reference, already_booked: true } });
  const fresh = (await run('RE1042', slot, 'fresh')).toolCalls[0]!.result;
  expect(fresh.ok).toBe(true);
  if (fresh.ok) expect(fresh.data.reference).not.toBe(existing.reference);
  expect((await db.owner.query("SELECT * FROM sandbox.re_requests WHERE tenant=$1 AND kind='viewing' AND slot=$2", [tenant, slot])).rows).toHaveLength(2);
});
it('reuses an open viewing even when its listing is no longer available', async () => {
  const { tenant, run } = await estateSetup();
  await db.owner.query("INSERT INTO sandbox.re_listings(tenant,unit,community,bedrooms,rent_aed,status,permit_number,agent_key) SELECT tenant,'RE1099',community,bedrooms,rent_aed,'reserved',permit_number,agent_key FROM sandbox.re_listings WHERE tenant=$1 AND unit='RE1042'", [tenant]);
  const existing = (await db.owner.query<{ reference: string }>("INSERT INTO sandbox.re_requests(tenant,requester_key,kind,unit,slot,queue,agent_key,summary) VALUES($1,'omar','viewing','RE1099','Saturday at 11:00','viewings','ahmed_k','Existing viewing. معاينة موجودة.') RETURNING reference", [tenant])).rows[0]!;
  expect((await run('RE1099', 'السبت الساعة 11:00', 'repeat_reserved')).toolCalls[0]!.result).toMatchObject({ ok: true, data: { reference: existing.reference, already_booked: true } });
  expect((await db.owner.query("SELECT * FROM sandbox.re_requests WHERE tenant=$1 AND unit='RE1099'", [tenant])).rows).toHaveLength(1);
});
it('creates first viewings, different units and different slots, and preserves the planted duplicate', async () => {
  const { tenant, run } = await estateSetup();
  for (const [unit, slot] of [['RE1042', 'Sunday at 12:00'], ['RE4415', 'Saturday at 11:00']]) expect((await run(unit!, slot!, unit!)).toolCalls[0]!.result.ok).toBe(true);
  expect((await db.owner.query("SELECT * FROM sandbox.re_requests WHERE tenant=$1 AND kind='viewing'", [tenant])).rows).toHaveLength(3);
  const planted = await estateSetup(true);
  await planted.run('RE1042', 'Saturday at 11:00', 'planted');
  expect((await db.owner.query("SELECT * FROM sandbox.re_requests WHERE tenant=$1 AND kind='viewing'", [planted.tenant])).rows).toHaveLength(2);
});
async function shopSetup(planted = false) {
  const tenant = `oct28_sh_${++n}`;
  await db.driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_worker'); await sql.query('SELECT sandbox.sh_seed_tenant($1)', [tenant]); });
  const run = (order: string, key: string) => runShopAgent({ model: callModel('create_request', { kind: 'cancellation', order_reference: order, summary: 'Cancel order. إلغاء الطلب.' }), version: planted ? shopVersions.planted_duplicate_request : shopVersions.baseline, messages: [{ role: 'user', content: cases('ecommerce').find((c) => c.stable_key === 'cancel_order_trap_ar')!.resident_turns[0]! }], sandbox: { driver: db.driver, tenant, requesterKey: 'anas' }, conversationKey: key });
  await run('OR1011', 'initial');
  return { tenant, run };
}
it('reuses the existing cancellation with bilingual audited output across independent calls', async () => {
  const { tenant, run } = await shopSetup();
  const existing = (await db.owner.query<{ reference: string }>("SELECT reference FROM sandbox.sh_requests WHERE tenant=$1 AND customer_key='anas' AND kind='cancellation'", [tenant])).rows[0]!;
  for (const key of ['again', 'another_conversation', 'again']) {
    const result = (await run('OR1011', key)).toolCalls[0]!.result;
    expect(result).toMatchObject({ ok: true, data: { reference: existing.reference, already_logged: true, message: { en: expect.stringContaining('existing'), ar: expect.stringContaining('موجود') } } });
  }
  expect((await db.owner.query("SELECT * FROM sandbox.sh_requests WHERE tenant=$1 AND customer_key='anas'", [tenant])).rows).toHaveLength(1);
  expect((await db.owner.query("SELECT * FROM sandbox.tool_receipts WHERE tenant=$1 AND response->'data'->>'already_logged'='true'", [tenant])).rows).toHaveLength(3);
});
it('creates a cancellation for a different order and preserves the planted duplicate', async () => {
  const { tenant, run } = await shopSetup();
  await db.owner.query("INSERT INTO sandbox.sh_orders(tenant,reference,customer_key,sku,status,total_aed,placed_on) SELECT tenant,'OR1099',customer_key,sku,status,total_aed,placed_on FROM sandbox.sh_orders WHERE tenant=$1 AND reference='OR1011'", [tenant]);
  expect((await run('OR1099', 'first')).toolCalls[0]!.result.ok).toBe(true);
  expect((await db.owner.query("SELECT * FROM sandbox.sh_requests WHERE tenant=$1 AND customer_key='anas'", [tenant])).rows).toHaveLength(2);
  const planted = await shopSetup(true);
  await planted.run('OR1011', 'planted');
  expect((await db.owner.query("SELECT * FROM sandbox.sh_requests WHERE tenant=$1 AND customer_key='anas'", [planted.tenant])).rows).toHaveLength(2);
});


it('reuses an open cancellation even when the order has since shipped', async () => {
  const { tenant, run } = await shopSetup();
  await db.owner.query("INSERT INTO sandbox.sh_orders(tenant,reference,customer_key,sku,status,total_aed,placed_on) SELECT tenant,'OR1098',customer_key,sku,'shipped',total_aed,placed_on FROM sandbox.sh_orders WHERE tenant=$1 AND reference='OR1011'", [tenant]);
  const existing = (await db.owner.query<{ reference: string }>("INSERT INTO sandbox.sh_requests(tenant,customer_key,kind,order_reference,queue,summary) VALUES($1,'anas','cancellation','OR1098','fulfilment','Existing cancellation. طلب إلغاء موجود.') RETURNING reference", [tenant])).rows[0]!;
  expect((await run('OR1098', 'repeat_shipped')).toolCalls[0]!.result).toMatchObject({ ok: true, data: { reference: existing.reference, already_logged: true } });
  expect((await db.owner.query("SELECT * FROM sandbox.sh_requests WHERE tenant=$1 AND order_reference='OR1098'", [tenant])).rows).toHaveLength(1);
});
