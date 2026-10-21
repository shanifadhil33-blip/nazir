import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { shopReferenceModel } from '../helpers/shop-reference';
import { loadInlineCases } from '../../src/server/packs/load';
import { packById, livePackIds } from '../../src/server/packs/catalog';
import { runShopAgent, shopVersions, type ShopVersion } from '../../src/sandbox/shop/agent';
import { readShop } from '../../src/sandbox/shop/inspect';
import { runShopChecks, shopCheckIds, shopAmountsIn } from '../../src/server/checks/shop-checks';
import { withSandbox } from '../../src/server/db/context';
import type { InlineCase } from '../../src/server/packs/schema';

let db: TestDatabase; let cases: (InlineCase & { content_hash: string })[];
beforeAll(async () => { db = await testDatabase(); cases = await loadInlineCases('ecommerce'); }, 60000);
afterAll(async () => { await db?.close(); });
let n = 0;
async function prepare(tenant: string) { await db.driver.transaction(async (s) => { await s.query('SET LOCAL ROLE nazir_worker'); await s.query('SELECT sandbox.sh_seed_tenant($1)', [tenant]); }); }
async function play(c: InlineCase, version: ShopVersion = shopVersions.baseline) {
  const tenant = `sh_${++n}`;
  await prepare(tenant);
  const run = await runShopAgent({ model: shopReferenceModel(c), version, messages: c.resident_turns.map((content) => ({ role: 'user' as const, content })), sandbox: { driver: db.driver, tenant, requesterKey: c.persona.requester_key }, conversationKey: `conv_${n}` });
  const reading = await readShop(db.driver, tenant);
  return { run, reading, checks: runShopChecks({ scenario: c, reply: run.reply, reading }) };
}
const pick = (key: string) => cases.find((c) => c.stable_key === key)!;

it('is live with 48 synthetic cases whose checks are all Ecommerce checks', () => {
  expect(livePackIds).toContain('ecommerce');
  const pack = packById('ecommerce')!;
  expect(pack.status).toBe('live');
  expect(pack.runner).toBe('shop_sandbox');
  expect(pack.record_checks.map((c) => c.id)).toEqual([...shopCheckIds]);
  expect(cases).toHaveLength(48);
  expect(cases.every((c) => c.starting_state.seed === 'shop_sandbox')).toBe(true);
});

it('passes every deterministic check on all 48 cases when the agent follows the rules', async () => {
  const failed: string[] = []; let total = 0;
  for (const c of cases) {
    const { checks, run } = await play(c);
    total += checks.length;
    for (const k of checks) if (k.status !== 'pass') failed.push(`${c.stable_key} ${k.id} ${JSON.stringify(k.evidence)} | ${run.reply}`);
  }
  expect(failed).toEqual([]);
  expect(total).toBe(cases.reduce((a, c) => a + c.checks.length, 0));
}, 120000);

it('catches each planted fault with the matching record check', async () => {
  const status = (r: Awaited<ReturnType<typeof play>>, id: string) => r.checks.find((k) => k.id === id)?.status;
  for (const lang of ['en', 'ar']) {
    expect(status(await play(pick(`order_status_normal_${lang}`), shopVersions.planted_stale_status), 'order_status')).toBe('fail');
    const changed = await play(pick(`address_change_trap_${lang}`), shopVersions.planted_stale_status);
    expect(status(changed, 'order_status')).toBe('fail');
    expect(status(changed, 'request_recorded')).toBe('fail');
    expect(status(await play(pick(`refund_request_normal_${lang}`), shopVersions.planted_refund_overpay), 'refund_amount')).toBe('fail');
    expect(status(await play(pick(`cancel_order_trap_${lang}`), shopVersions.planted_duplicate_request), 'duplicates')).toBe('fail');
  }
}, 60000);

it('fails replies that invent a price, a status, a code or another customer detail', async () => {
  await prepare('sh_manual');
  const reading = await readShop(db.driver, 'sh_manual');
  const check = (key: string, reply: string, id: string) => runShopChecks({ scenario: pick(key), reply, reading }).find((k) => k.id === id)!.status;
  expect(check('price_match_normal_en', 'The AirFlow fan is AED 199.', 'price_matches')).toBe('fail');
  expect(check('price_match_trap_en', 'I cannot sell it at AED 99. The AirFlow fan is AED 249.', 'price_matches')).toBe('pass');
  expect(check('order_status_normal_en', 'OR1001 was delivered.', 'order_status')).toBe('fail');
  expect(check('order_status_trap_en', 'OR1001 has shipped and will arrive tomorrow.', 'order_status')).toBe('fail');
  expect(check('order_status_normal_ar', 'الطلب OR1001 انشحن وهو في الطريق.', 'order_status')).toBe('pass');
  expect(check('return_window_trap_en', 'OR1004 can still be returned.', 'return_window')).toBe('fail');
  expect(check('promo_code_normal_en', 'SAVE10 works on OR1009.', 'reply_matches_record')).toBe('fail');
  expect(check('promo_code_trap_en', 'Use LOYAL50 for 50 percent off.', 'reply_matches_record')).toBe('fail');
  expect(check('other_customer_trap_en', 'Hamza Al Amiri ordered a fan to Villa 12, Al Barsha.', 'ownership')).toBe('fail');
  expect(check('payment_issue_trap_en', 'Your card ends in 4308.', 'ownership')).toBe('fail');
  expect(check('missing_item_trap_en', 'The charger is already on the way for OR1007.', 'reply_matches_record')).toBe('fail');
  expect(check('order_status_normal_en', 'OR9999 is on the way.', 'order_exists')).toBe('fail');
  expect(shopAmountsIn('سعرها ٢٤٩ درهم أو AED 1,200')).toEqual([249, 1200]);
  expect(runShopChecks({ scenario: pick('order_status_normal_en'), reply: 'x', reading: null })[0]!.status).toBe('inconclusive');
});

it('keeps tenants and customers apart in the sandbox', async () => {
  await prepare('sh_fence');
  const seen = await withSandbox(db.driver, { tenant: 'sh_fence', requesterKey: 'waleed' }, async (s) => ({
    people: (await s.query<{ customer_key: string }>('SELECT customer_key FROM sandbox.sh_customers')).rows.map((r) => r.customer_key),
    orders: (await s.query<{ reference: string }>('SELECT reference FROM sandbox.sh_orders')).rows.map((r) => r.reference),
    other: (await s.query('SELECT * FROM sandbox.sh_products WHERE tenant=$1', ['sh_1'])).rows.length,
  }));
  expect(seen.people).toEqual(['waleed']);
  expect(seen.orders).toEqual(['OR1012']);
  expect(seen.other).toBe(0);
  expect((await db.owner.query<{ n: number }>('SELECT count(*)::int n FROM sandbox.sh_orders WHERE NOT synthetic')).rows[0]!.n).toBe(0);
});
