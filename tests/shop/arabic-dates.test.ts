import { expect, it } from 'vitest';
import { replyDates } from '../../src/server/checks/dates';
import { runShopChecks } from '../../src/server/checks/shop-checks';
import type { ShopReading } from '../../src/sandbox/shop/inspect';
import type { InlineCase } from '../../src/server/packs/schema';

it.each(['25 سبتمبر 2026', '٢٥ سبتمبر ٢٠٢٦', '۲۵ أيلول ۲۰۲۶', '25 ايلول 2026'])('accepts the recorded bold Arabic deadline %s (7d4c4395)', (date) => {
  const scenario = { checks: ['return_window'], persona: { requester_key: 'me' }, resident_turns: [], expected: { unit: 'OR1004', requests: [], states: {} } } as unknown as InlineCase;
  const reading = { orders: [{ reference: 'OR1004', customer_key: 'me', status: 'delivered', charges: [], return_until: '2026-09-25' }], requests: [], promotions: [], products: [] } as unknown as ShopReading;
  const check = (deadline: string) => runShopChecks({ scenario, reading, reply: `مهلة الإرجاع 14 يوما، أي حتى **${deadline}**.` })[0];
  expect(check(date)?.status).toBe('pass');
  expect(check('26 سبتمبر 2026')?.status).toBe('fail');
  expect(check('لا يوجد تاريخ')?.status).toBe('fail');
});

it.each([
  ['كانون الثاني', '01'], ['شباط', '02'], ['آذار', '03'], ['نيسان', '04'], ['أيار', '05'], ['حزيران', '06'],
  ['تموز', '07'], ['آب', '08'], ['أيلول', '09'], ['تشرين الأول', '10'], ['تشرين الثاني', '11'], ['كانون الأول', '12'],
])('parses Levant month %s', (month, number) => {
  expect(replyDates(`**٢٥ ${month} ٢٠٢٦**`)).toEqual([`2026-${number}-25`]);
});

it('reads the live return deadline alongside the same order delivery and warranty dates', () => {
  const scenario = { checks: ['return_window'], persona: { requester_key: 'me' }, resident_turns: [], expected: { unit: 'OR1004', requests: [], states: {} } } as unknown as InlineCase;
  const reading = { orders: [{ reference: 'OR1004', customer_key: 'me', status: 'delivered', charges: [], placed_on: '2026-09-09', delivered_on: '2026-09-11', return_until: '2026-09-25', warranty_until: '2027-09-11', shipment: { eta: '2026-09-10' } }], requests: [], promotions: [], products: [] } as unknown as ShopReading;
  const reply = 'عذراً، طلبك **OR1004** (مصباح مكتب) تم تسليمه في **11 سبتمبر 2026**، ونافذة الإرجاع حسب سياسة المتجر تنتهي بعد **14 يوماً** من التسليم، أي في **25 سبتمبر 2026**. اليوم مرّ **40 يوماً** على التسليم، وبالتالي الطلب خارج فترة الإرجاع المسموحة.\n\n**الخيارات المتاحة:**\n1. **ضمان المنتج** ساري حتى **11 سبتمبر 2027** — إذا كان هناك عيب تصنيع، يمكنك طلب إصلاح.';
  const check = (reply: string) => runShopChecks({ scenario, reading, reply })[0]?.status;
  expect(check(reply)).toBe('pass');
  expect(check(reply.replace('25 سبتمبر 2026', '26 سبتمبر 2026'))).toBe('fail');
  for (const date of ['2026-09-09', '2026-09-10', '2026-09-11', '2027-09-11']) expect(check(`OR1004 return deadline 2026-09-25; return context ${date}.`)).toBe('pass');
  expect(check('OR1004 return context 2026-09-11.')).toBe('fail');
});
