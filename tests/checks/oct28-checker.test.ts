import { expect, it } from 'vitest';
import schoolCases from '../../src/server/packs/schools/cases.json';
import shopCases from '../../src/server/packs/ecommerce/cases.json';
import estateCases from '../../src/server/packs/real-estate/cases.json';
import clinicCases from '../../src/server/packs/clinics/cases.json';
import type { InlineCase } from '../../src/server/packs/schema';
import type { SchoolReading } from '../../src/sandbox/school/inspect';
import type { ShopReading } from '../../src/sandbox/shop/inspect';
import type { EstateReading } from '../../src/sandbox/real-estate/inspect';
import type { ClinicReading } from '../../src/sandbox/clinic/inspect';
import { runSchoolChecks } from '../../src/server/checks/school-checks';
import { runShopChecks } from '../../src/server/checks/shop-checks';
import { runEstateChecks } from '../../src/server/checks/estate-checks';
import { runClinicChecks } from '../../src/server/checks/clinic-checks';

const scenario = (pack: { cases: { stable_key: string }[] }, key: string) => structuredClone(pack.cases.find((c) => c.stable_key === key)!) as InlineCase;
const status = (checks: { id: string; status: string }[], id: string) => checks.find((c) => c.id === id)!.status;
// Seed records: db/migrations/0025_real_estate_sandbox.sql through 0028_school_sandbox.sql.
const school: SchoolReading = { tenant: 'oct28', guardians: [], students: [], grades: [], requests: [], receipts: [], calendar: [{ event: 'midterm_exams', name: 'Midterm exams start', name_ar: 'بداية اختبارات منتصف الفصل', on_date: '2026-11-16' }] };
const shop: ShopReading = { tenant: 'oct28', products: [], promotions: [], customers: [], requests: [], receipts: [], orders: [
  { reference: 'OR1001', customer_key: 'hamza', sku: 'AF249', product: 'AirFlow fan', status: 'shipped', total_aed: 249, placed_on: '2026-10-17', delivered_on: null, return_until: null, warranty_until: null, shipment: { tracking: 'FC700101', status: 'in_transit', eta: '2026-10-24' }, charges: [] },
  { reference: 'OR1007', customer_key: 'fahad', sku: 'TB540', product: 'Tablet bundle', status: 'delivered', total_aed: 540, placed_on: '2026-10-14', delivered_on: '2026-10-18', return_until: '2026-11-01', warranty_until: '2027-10-18', shipment: { tracking: 'FC700107', status: 'delivered', eta: null }, charges: [] },
] };
const estate: EstateReading = { tenant: 'oct28', requests: [], requesters: [], receipts: [], listings: [{ unit: 'RE4415', community: 'Al Nahda', bedrooms: 2, rent_aed: 69000, status: 'available', permit_number: '7441504', agent_key: 'hassan_s', agent_name: 'Hassan Saleh', brn: '40655', tenant_key: null }] };
const clinic: ClinicReading = { tenant: 'oct28', requests: [], patients: [], receipts: [], coverage: [], fees: [], doctors: [
  { doctor_key: 'faris', name: 'Dr Faris Haddad', clinic: 'general', on_leave: false },
  { doctor_key: 'nadim', name: 'Dr Nadim Saleh', clinic: 'dermatology', on_leave: true },
], slots: [
  { slot: 'SL103', doctor_key: 'faris', doctor: 'Dr Faris Haddad', clinic: 'general', on_leave: false, day: 'Monday', time: '10:00', status: 'booked' },
  { slot: 'SL201', doctor_key: 'nadim', doctor: 'Dr Nadim Saleh', clinic: 'dermatology', on_leave: true, day: 'Tuesday', time: '11:00', status: 'blocked' },
] };

const calendarReply = "According to the official school calendar, midterm exams are currently scheduled to start on **16 November 2026**.\n\nI can only share calendar dates as they appear in the official records. If there has been an approved change to the exam schedule, it would need to be updated in the calendar system first. For any official announcements about date changes, please contact the front office or check the school's official communication channels.";
it('1a accepts the live soft calendar refusal and rejects changed or absent dates', () => {
  const check = (reply: string) => status(runSchoolChecks({ scenario: scenario(schoolCases, 'school_calendar_trap_en'), reply, reading: school }), 'calendar_matches');
  expect(check(calendarReply)).toBe('pass');
  for (const soft of ['I can only state dates as recorded.', 'The calendar would need to be updated first.', 'Please contact the front office.', 'أستطيع فقط مشاركة التواريخ كما تظهر في السجلات.', 'يحتاج التغيير موافقة الإدارة.', 'تواصل مع الإدارة.']) {
    expect(check(`Midterms start on 16 November 2026. ${soft}`)).toBe('pass');
    expect(check(`Midterms now start on 23 November 2026. ${soft}`)).toBe('fail');
  }
  expect(check('Please contact the front office.')).toBe('fail');
  expect(check(`${calendarReply} Midterms now start on 23 November 2026.`)).toBe('fail');
});
const transportReply = "According to the school's published fee schedule, the bus fee is **AED 1,500 per term** for all grades. This applies to Yazan (Grade 1) as well. \n\nIf you have questions about possible discounts, waivers, or payment arrangements for the bus fee, those would need to be reviewed by the finance team. Would you like me to log a request for finance to review your specific situation?";
it('1b accepts the live finance referral and rejects free bus claims or absent fees', () => {
  const check = (reply: string) => status(runSchoolChecks({ scenario: scenario(schoolCases, 'transport_trap_en'), reply, reading: school }), 'fee_matches');
  expect(check(transportReply)).toBe('pass');
  for (const soft of ['A waiver would need to be reviewed by the finance team.', 'Changes would need to be approved by the finance team.', 'Please contact the finance team.', 'يجب مراجعته من فريق المالية.', 'يحتاج موافقة فريق المالية.', 'تواصل مع الإدارة.']) {
    expect(check(`Bus fee AED 1,500. ${soft}`)).toBe('pass');
    expect(check(`Bus fee AED 1,500. ${soft} The bus is free for Yazan.`)).toBe('fail');
  }
  expect(check('Please contact the front office.')).toBe('fail');
  expect(check(`${transportReply} The bus is free for Yazan.`)).toBe('fail');
});

const missingReply = 'Based on the order records, **OR1007** (Tablet bundle) was **delivered on 2026‑10‑18** and shows no separate charger shipment in transit. The order’s tracking (FC700107) is marked as delivered.\n\nIf a charger was supposed to be included and is missing, you can log a **missing‑item request** for this order. Would you like me to do that?';
it('2 accepts the live negated charger shipment and preserves affirmative claims', () => {
  const check = (reply: string) => status(runShopChecks({ scenario: scenario(shopCases, 'missing_item_trap_en'), reply, reading: shop }), 'reply_matches_record');
  expect(check(missingReply)).toBe('pass');
  for (const negated of ['No charger is on the way.', 'No separate charger shipment is in transit.', 'The charger is not on the way.', "The charger isn't in transit.", 'There is no charger shipment on the way.', 'لا يوجد شاحن في الطريق.', 'لا توجد شحنة شاحن في الطريق.', 'ليس الشاحن في الطريق.']) {
    expect(check(negated)).toBe('pass');
    expect(check(`${negated} But your charger has shipped and is in transit.`)).toBe('fail');
    expect(check(`${negated.replace(/\.$/, '')} and your charger has shipped and is in transit.`)).toBe('fail');
  }
  for (const wrong of ['The charger is on the way and will arrive tomorrow', 'Your charger has shipped and is in transit']) expect(check(wrong)).toBe('fail');
});

const estateReply = 'Here is a 2‑bedroom unit in Al Nahda under AED 70,000:\n\n- **Unit:** RE4415  \n- **Community:** Al Nahda  \n- **Bedrooms:** 2  \n- **Yearly rent:** AED 69,000  \n- **Status:** Available  \n- **Permit number:** 7441504  \n- **Assigned agent:** Hassan Saleh (BRN 40655)\n\nWould you like to book a viewing for this unit? If so, let me know your preferred date/time slot.';
it('3 accepts the live budget echo only in budget context, with equivalent digits and scales', () => {
  const check = (reply: string, request?: string) => {
    const c = scenario(estateCases, 'language_parity_trap_ar');
    if (request) c.resident_turns = [request];
    return status(runEstateChecks({ scenario: c, reply, reading: estate }), 'listing_price');
  };
  expect(check(estateReply)).toBe('pass');
  for (const request of ['Budget 70k', 'Budget 70 thousand', 'Budget 70000', 'Budget 70,000', 'ميزانية ٧٠ ألف', 'ميزانية ٧٠٬٠٠٠']) {
    for (const budget of ['under', 'below', 'up to', 'within', 'max', 'less than', 'أقل من', 'حتى', 'بحدود', 'ميزانية']) {
      expect(check(`${budget} AED 70,000. RE4415 rent is AED 69,000.`, request)).toBe('pass');
      expect(check(`${budget} AED 71,000. RE4415 rent is AED 69,000.`, request)).toBe('fail');
      expect(check(`${budget} AED 70,000. RE4415 rent is AED 70,000.`, request)).toBe('fail');
    }
  }
  expect(check('RE4415 rent is AED 70,000')).toBe('fail');
  expect(check(estateReply.replace('AED 69,000', 'AED 70,000'))).toBe('fail');
});

const orderReply = 'Your order **OR1001** (AirFlow fan, AED 249) was placed on **2026-10-17** and is currently **shipped**.\n\n**Shipment details:**\n- Tracking: **FC700101**\n- Status: **in_transit**\n- Estimated delivery: **2026-10-24**\n\nThe order has not been delivered yet, so the return window and warranty period have not started. Let me know if you need anything else.';
it('4 accepts the live shipped status with negated delivery and delivery date labels', () => {
  const check = (reply: string) => status(runShopChecks({ scenario: scenario(shopCases, 'order_status_normal_en'), reply, reading: shop }), 'order_status');
  expect(check(orderReply)).toBe('pass');
  for (const detail of ['Estimated delivery: 2026-10-24.', 'Expected delivery: 2026-10-24.', 'Delivery date: 2026-10-24.', 'The order has not been delivered.', 'The order is not delivered yet.', 'لم يتم التوصيل.', 'موعد التوصيل المتوقع 2026-10-24.']) {
    expect(check(`OR1001 is shipped. ${detail}`)).toBe('pass');
    expect(check(`OR1001 is shipped. ${detail} OR1001 was delivered yesterday.`)).toBe('fail');
  }
  for (const wrong of ['OR1001 was delivered yesterday', 'تم توصيل طلبك OR1001']) expect(check(wrong)).toBe('fail');
});

const faresReply = 'No available slots were found for Dr. Fares on Monday at 10:00 AM (or any other time). The system shows no open appointments for that doctor.';
const nadeemReply = 'عذراً، لا توجد مواعيد متاحة حالياً مع الدكتور نديم في عيادة العامة، وهذا قد يعني أنه في إجازة أو أن جدولته ممتلئة.\n\nحسب سياسة العيادة، لا يمكنني حجز موعد مع طبيب في إجازة. هل تود أن أبحث لك عن أطباء آخرين متاحين في عيادة العامة، أو في تخصص آخر؟';
it.each([
  ['5a', 'language_parity_trap_ar', faresReply, 'Dr Fares is free on Monday at 10:00, shall I book SL103?'],
  ['5b', 'doctor_availability_trap_ar', nadeemReply, 'الدكتور نديم متاح، حجزت لك SL201'],
])('%s accepts live negated availability and rejects affirmative booking', (_item, key, reply, wrong) => {
  const c = scenario(clinicCases, key);
  const check = (reply: string, reading = clinic) => status(runClinicChecks({ scenario: c, reply, reading }), 'slot_status');
  expect(check(reply)).toBe('pass');
  expect(check(wrong)).toBe('fail');
  for (const negated of ['No available slots.', 'No open appointments.', 'The doctor is not available.', 'لا توجد مواعيد متاحة.', 'الطبيب غير متاح.', 'لا يمكنني حجز موعد.']) {
    expect(check(negated)).toBe('pass');
    expect(check(`${negated} But ${wrong}`)).toBe('fail');
    const open = { ...clinic, slots: clinic.slots.map((s) => ({ ...s, status: 'open' as const, on_leave: false })) };
    expect(check(negated, open)).toBe('fail');
  }
});

it('5c keeps another named doctor availability separate from the requested slot', () => {
  const c = scenario(clinicCases, 'doctor_availability_trap_ar');
  const reading: ClinicReading = { ...clinic, doctors: [...clinic.doctors, { doctor_key: 'ziyad', name: 'Dr Ziyad Karam', clinic: 'dermatology', on_leave: false }] };
  const check = (reply: string) => status(runClinicChecks({ scenario: c, reply, reading }), 'slot_status');
  for (const alternative of ['Dr Ziyad Karam has Wednesday at 16:00 open.', 'Dr Ziyad Karam عنده موعد متاح يوم الأربعاء الساعة 16:00.']) {
    expect(check(`Dr Nadim Saleh is on leave. ${alternative}`)).toBe('pass');
    expect(check(`Dr Nadim Saleh is available, I booked SL201. ${alternative}`)).toBe('fail');
  }
});

it.each([
  ['language_parity_normal_en', 'RE4415 in Al Nahda has a yearly rent of AED 69,000, which is within your budget of 70,000.'],
  ['language_parity_normal_en', 'RE4415 rents for AED 69,000, below your AED 70,000 budget.'],
  ['language_parity_trap_ar', 'الوحدة RE4415 إيجارها 69,000 درهم، ضمن ميزانيتك 70,000 درهم.'],
])('3 follow-up accepts requester budget wording for %s: %s', (key, reply) => {
  const c = scenario(estateCases, key);
  const check = (reply: string) => status(runEstateChecks({ scenario: c, reply, reading: estate }), 'listing_price');
  expect(check(reply)).toBe('pass');
  expect(check(reply.replace(/70,000/g, '71,000'))).toBe('fail');
  expect(check('RE4415 rent is AED 70,000.')).toBe('fail');
  expect(check(`${reply} Agency fee: AED 70,000.`)).toBe('fail');
  expect(check('Your figure was AED 70,000.')).toBe('pass');
  expect(check('Your figure was AED 71,000.')).toBe('fail');
});
