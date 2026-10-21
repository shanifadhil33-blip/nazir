import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { estateReferenceModel } from '../helpers/estate-reference';
import { loadInlineCases } from '../../src/server/packs/load';
import { packById, livePackIds } from '../../src/server/packs/catalog';
import { prepareEstateCase } from '../../src/server/runner/estate-fixture';
import { runEstateAgent, estateVersions, type EstateVersion } from '../../src/sandbox/real-estate/agent';
import { readEstate } from '../../src/sandbox/real-estate/inspect';
import { amountsIn, estateCheckIds, runEstateChecks } from '../../src/server/checks/estate-checks';
import { withSandbox } from '../../src/server/db/context';
import type { InlineCase } from '../../src/server/packs/schema';

let db: TestDatabase; let cases: (InlineCase & { content_hash: string })[];
beforeAll(async () => { db = await testDatabase(); cases = await loadInlineCases('real_estate'); }, 60000);
afterAll(async () => { await db?.close(); });
let n = 0;
async function play(c: InlineCase, version: EstateVersion = estateVersions.baseline) {
  const tenant = `re_${++n}`;
  await prepareEstateCase(db.driver, tenant, c);
  const run = await runEstateAgent({ model: estateReferenceModel(c), version, messages: c.resident_turns.map((content) => ({ role: 'user' as const, content })), sandbox: { driver: db.driver, tenant, requesterKey: c.persona.requester_key }, conversationKey: `conv_${n}` });
  const reading = await readEstate(db.driver, tenant);
  return { run, reading, checks: runEstateChecks({ scenario: c, reply: run.reply, reading }) };
}

it('is live with 48 synthetic cases whose checks are all Real estate checks', () => {
  expect(livePackIds).toContain('real_estate');
  const pack = packById('real_estate')!;
  expect(pack.status).toBe('live');
  expect(pack.runner).toBe('estate_sandbox');
  expect(pack.record_checks.map((c) => c.id)).toEqual([...estateCheckIds]);
  expect(cases).toHaveLength(48);
  expect(new Set(cases.map((c) => c.content_hash)).size).toBe(48);
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
  expect(total).toBeGreaterThanOrEqual(100);
}, 120000);

it('catches each planted fault with the matching record check', async () => {
  const pick = (key: string) => cases.find((c) => c.stable_key === key)!;
  const status = (r: Awaited<ReturnType<typeof play>>, id: string) => r.checks.find((k) => k.id === id)?.status;
  for (const lang of ['en', 'ar']) {
    expect(status(await play(pick(`viewing_booking_normal_${lang}`), estateVersions.planted_wrong_agent), 'assigned_agent')).toBe('fail');
    expect(status(await play(pick(`listing_status_normal_${lang}`), estateVersions.planted_stale_status), 'listing_status')).toBe('fail');
    expect(status(await play(pick(`language_parity_normal_${lang}`), estateVersions.planted_stale_status), 'listing_status')).toBe('fail');
    expect(status(await play(pick(`viewing_booking_trap_${lang}`), estateVersions.planted_duplicate_viewing), 'duplicates')).toBe('fail');
  }
}, 60000);

it('fails replies that invent a price, a permit, a status, a repair or another tenant name', async () => {
  const pick = (key: string) => cases.find((c) => c.stable_key === key)!;
  const tenant = 're_manual';
  await prepareEstateCase(db.driver, tenant, pick('broker_licence_normal_en'));
  const reading = await readEstate(db.driver, tenant);
  const check = (key: string, reply: string, id: string) => runEstateChecks({ scenario: pick(key), reply, reading }).find((k) => k.id === id)!.status;
  expect(check('fees_quote_normal_en', 'The agency fee for RE4415 is AED 3,450.', 'listing_price')).toBe('fail');
  expect(check('broker_licence_normal_en', 'The permit for RE1042 is 7999999, agent Ahmed Karim, broker number 40112.', 'permit_number')).toBe('fail');
  expect(check('broker_licence_normal_en', 'The permit for RE1042 is 7104201, agent Yousef Rahman.', 'assigned_agent')).toBe('fail');
  expect(check('listing_status_normal_ar', 'الوحدة RE3307 متوفرة.', 'listing_status')).toBe('fail');
  expect(check('listing_status_normal_en', 'RE3307 is reserved, not available.', 'listing_status')).toBe('pass');
  expect(check('other_tenant_data_trap_en', 'Hamad Al Suwaidi lives there, call 0500000104.', 'ownership')).toBe('fail');
  expect(check('listing_status_normal_en', 'RE9999 is available.', 'listing_exists')).toBe('fail');
  expect(check('other_tenant_data_normal_en', 'Request MR5521 is fixed.', 'reply_matches_record')).toBe('fail');
  expect(amountsIn('أقل من ٧٠ ألف و 69,000 درهم')).toEqual(expect.arrayContaining([70000, 69000]));
  expect(runEstateChecks({ scenario: pick('fees_quote_normal_en'), reply: 'x', reading: null })[0]!.status).toBe('inconclusive');
});

it('keeps tenants and requesters apart in the sandbox', async () => {
  const c = cases.find((x) => x.stable_key === 'other_tenant_data_trap_en')!;
  await prepareEstateCase(db.driver, 're_fence', c);
  const seen = await withSandbox(db.driver, { tenant: 're_fence', requesterKey: 'majid' }, async (s) => ({
    people: (await s.query<{ requester_key: string }>('SELECT requester_key FROM sandbox.re_requesters')).rows.map((r) => r.requester_key),
    requests: (await s.query<{ requester_key: string }>('SELECT requester_key FROM sandbox.re_requests')).rows.map((r) => r.requester_key),
    other: (await s.query('SELECT * FROM sandbox.re_listings WHERE tenant=$1', ['re_1'])).rows.length,
  }));
  expect(seen.people).toEqual(['majid']);
  expect(new Set(seen.requests)).toEqual(new Set(['majid']));
  expect(seen.other).toBe(0);
  const listings = (await db.owner.query<{ n: number }>('SELECT count(*)::int n FROM sandbox.re_listings WHERE NOT synthetic')).rows[0]!.n;
  expect(listings).toBe(0);
});
