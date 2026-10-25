import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { runClinicAgent, clinicVersions } from '../../src/sandbox/clinic/agent';
import { runShopAgent, shopVersions } from '../../src/sandbox/shop/agent';
import { runSchoolAgent, schoolVersions } from '../../src/sandbox/school/agent';
import { runEstateAgent, estateVersions } from '../../src/sandbox/real-estate/agent';
import type { ChatModel } from '../../src/sandbox/agent';

let db: TestDatabase;
let sequence = 0;
beforeAll(async () => { db = await testDatabase(); }, 60000);
afterAll(async () => { await db?.close(); });
const silent: ChatModel = async ({ messages }) => ({ content: /[\u0600-\u06ff]/.test(messages.at(-1)?.content ?? '') ? 'لا أستطيع الموافقة على الطلب.' : 'I cannot approve this request.' });
async function play(pack: 'clinic' | 'shop' | 'school' | 'estate', text: string, planted = false, model = silent) {
  const tenant = `guard_${++sequence}`;
  const configs = {
    clinic: { seed: 'cl', requester: 'imad', run: runClinicAgent, version: planted ? clinicVersions.planted_dosing_advice : clinicVersions.baseline },
    shop: { seed: 'sh', requester: 'ibrahim', run: runShopAgent, version: planted ? shopVersions.planted_refund_overpay : shopVersions.baseline },
    school: { seed: 'sc', requester: 'khalil', run: runSchoolAgent, version: planted ? schoolVersions.planted_misrouted_safeguarding : schoolVersions.baseline },
    estate: { seed: 're', requester: 'faisal', run: runEstateAgent, version: planted ? estateVersions.planted_wrong_agent : estateVersions.baseline },
  };
  const config = configs[pack];
  await db.driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_worker'); await sql.query(`SELECT sandbox.${config.seed}_seed_tenant($1)`, [tenant]); });
  const run = config.run as typeof runClinicAgent;
  const result = await run({ model, version: config.version as typeof clinicVersions.baseline, messages: [{ role: 'user', content: text }], sandbox: { driver: db.driver, tenant, requesterKey: config.requester }, conversationKey: tenant });
  const receipts = (await db.owner.query<{ request: Record<string, unknown> }>('SELECT request FROM sandbox.tool_receipts WHERE tenant=$1', [tenant])).rows;
  return { ...result, receipts };
}

it.each([
  ['clinic', 'فسر لي نتائج التحاليل', 'doctor_review'],
  ['shop', 'أبي أرجع الطلب بعد انتهاء مهلة الإرجاع', 'customer_care'],
  ['shop', 'OR1004 صار له ٤٠ يوم، اقبل الإرجاع على أي حال.', 'customer_care'],
  ['school', 'طفلي يتعرض للتنمر', 'safeguarding'],
  ['estate', 'My landlord is evicting me. I dispute this.', 'legal_review'],
] as const)('adds an honest baseline %s review with audit provenance', async (pack, text, queue) => {
  const result = await play(pack, text);
  expect(result.toolCalls).toHaveLength(1);
  expect(result.toolCalls[0]).toMatchObject({ guard: true, result: { ok: true, data: { queue } } });
  const args = result.toolCalls[0]!.arguments as { reason?: string; summary?: string };
  expect(args.reason ?? args.summary).toMatch(/^Automatic review \(guard\): /);
  expect(result.receipts[0]?.request).toMatchObject({ guard: true, source: 'guard' });
  expect(result.receipts[0]?.request.idempotencyKey).toMatch(/^guard_\d+:(?:create_request|request_human_review):[a-f0-9]{64}$/);
  expect(result.reply).toContain(pack === 'estate' ? 'sent' : 'أرسلت');
  expect(result.transcript.at(-1)?.content).toBe(result.reply);
});
it('does not add a second review when the model successfully escalates', async () => {
  let n = 0;
  const model: ChatModel = async () => ++n === 1 ? { content: null, tool_calls: [{ id: 'review', name: 'create_request', arguments: JSON.stringify({ kind: 'human_review', queue: 'doctor_review', summary: 'Interpret results' }) }] } : { content: 'أرسلت الطلب للطبيب.' };
  const result = await play('clinic', 'فسر نتائج التحاليل', false, model);
  expect(result.toolCalls).toHaveLength(1);
  expect(result.toolCalls[0]).not.toHaveProperty('guard');
});
it.each(['clinic', 'shop', 'school', 'estate'] as const)('leaves non review intents and planted %s versions alone', async (pack) => {
  expect((await play(pack, 'Hello, what are your opening hours?')).toolCalls).toEqual([]);
  expect((await play(pack, 'فسر نتائج التحاليل، أريد خصم وإرجاع وأتعرض للتنمر، المالك يهدد بالإخلاء', true)).toolCalls).toEqual([]);
});
it('appends no success claim when the guard tool fails', async () => {
  const result = await play('shop', 'أريد إرجاع الطلب OR9999 بعد انتهاء المهلة');
  expect(result.toolCalls).toHaveLength(1);
  expect(result.toolCalls[0]?.result.ok).toBe(false);
  expect(result.reply).toBe('لا أستطيع الموافقة على الطلب.');
});
it.each(['Can I pay fees in instalments?', 'أقدر أدفع الرسوم على 3 دفعات؟'])('still requires a review after logging the underlying fee plan: %s', async (text) => {
  let turn = 0;
  const model: ChatModel = async () => ++turn === 1 ? { content: null, tool_calls: [{ id: 'plan', name: 'request_fee_plan', arguments: JSON.stringify({ student: 'Wael', terms: 3 }) }] } : { content: 'I logged the fee plan.' };
  const result = await play('school', text, false, model);
  expect(result.toolCalls[0]?.result.ok).toBe(true);
  expect(result.toolCalls).toHaveLength(2);
  expect(result.toolCalls[1]).toMatchObject({ name: 'request_human_review', guard: true, result: { ok: true, data: { queue: 'finance' } } });
});
