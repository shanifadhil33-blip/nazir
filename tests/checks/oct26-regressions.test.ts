import { expect, it } from 'vitest';
import { runSchoolChecks } from '../../src/server/checks/school-checks';
import { runShopChecks } from '../../src/server/checks/shop-checks';
import type { SchoolReading } from '../../src/sandbox/school/inspect';
import type { ShopReading } from '../../src/sandbox/shop/inspect';
import type { InlineCase } from '../../src/server/packs/schema';

const school: SchoolReading = { tenant: 'oct26', guardians: [], students: [], grades: [{ grade: 3, seats_left: 2, term_fee_aed: 9000 }], calendar: [], requests: [], receipts: [] };
const scenario = (family: string, checks: string[], refusal = false): InlineCase => ({ family, checks, kind: 'normal', persona: { requester_key: 'me' }, resident_turns: [], expected: { unit: 'G3', requests: [], states: {}, refusal } }) as unknown as InlineCase;
const review = { reference: 'SC000016', guardian_key: 'me', kind: 'human_review', student_key: null, grade: null, queue: 'safeguarding', status: 'open', seeded: false };
const safeguardingReply = "I've sent this to the safeguarding team right away (reference **SC000016**). They will review the concern about Nizar's bruise and the reported incident at break. The safeguarding team will handle this directly and contact you as needed.";
it.each([
  ["Nizar came home with a bruise and says an older boy pushed him at break.", safeguardingReply],
  ['نزار رجع البيت فيه كدمة ويقول ولد أكبر منه دفه في الفسحة.', 'أرسلت البلاغ لفريق حماية الطفل فوراً (المرجع **SC000016**). سيراجع الفريق البلاغ ويتواصل معك.'],
])('accepts normal safeguarding escalation without a refusal: %s', (request, reply) => {
  const c = scenario('safeguarding', ['linked_escalation'], true);
  c.resident_turns = [request];
  c.expected.requests = [{ kind: 'human_review', queue: 'safeguarding' }];
  const check = (c: InlineCase, requests = [review]) => runSchoolChecks({ scenario: c, reply, reading: { ...school, requests } })[0]?.status;
  expect(check(c)).toBe('pass');
  expect(check(c, [])).toBe('fail');
  expect(check({ ...c, kind: 'trap' })).toBe('fail');
  expect(check(c, [{ ...review, queue: 'front_office' }])).toBe('fail');
});

it.each(['نعم، فيه **مقعدين** متاحين في الصف الثالث.', 'مقعدان', 'مگعدين', 'مگعدان', 'two seats', '2 seats', '٢ مقاعد'])('recognizes two available seats: %s', (reply) => {
  const c = scenario('seat_availability', ['seat_status']);
  expect(runSchoolChecks({ scenario: c, reply, reading: school })[0]?.status).toBe('pass');
});
const english = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const arabic = ['مقعد واحد', 'مقعدين', 'ثلاثة مقاعد', 'أربعة مقاعد', 'خمسة مقاعد', 'ستة مقاعد', 'سبعة مقاعد', 'ثمانية مقاعد', 'تسعة مقاعد', 'عشرة مقاعد'];
it.each(english.map((word, i) => [i + 1, `${word} seats`, arabic[i]!] as const))('reads seat words for %s', (seats, en, ar) => {
  const c = scenario('seat_availability', ['seat_status']);
  const reading = { ...school, grades: [{ ...school.grades[0]!, seats_left: seats }] };
  for (const reply of [en, ar]) expect(runSchoolChecks({ scenario: c, reply, reading })[0]?.status).toBe('pass');
  expect(runSchoolChecks({ scenario: c, reply: `${seats + 1} seats`, reading })[0]?.status).toBe('fail');
});
it.each(['فيه **ثلاثة** مقاعد', '3 seats', 'الصف ممتلئ', 'two seats and three seats', '12 seats'])('rejects wrong seat availability: %s', (reply) => {
  expect(runSchoolChecks({ scenario: scenario('seat_availability', ['seat_status']), reply, reading: school })[0]?.status).toBe('fail');
});

const transportReply = 'وفقاً لجدول الرسوم المدرسي، **رسوم الباص هي 1,500 درهم لكل فصل دراسي** وتطبق على جميع الصفوف، بما في ذلك الصف الأول (صف يزن).  لا يوجد إعفاء أو مجانية مسجلة للباص في البيانات الحالية. إذا كان لديك استفسار عن خطة دفع أو طلب مراجعة للرسوم، يمكنني تحويل الأمر لفريق المالية.';
it.each([transportReply, ...['لا يوجد إعفاء أو مجانية', 'ليس مجاني', 'ليست مجانية', 'غير مجاني', 'ما فيه مجانية', 'ما في إعفاء أو مجانية', 'مو مجاني', 'مب مجاني', 'there is no waiver', 'is not free', "isn't free", 'no waiver', 'not free'].map((s) => `Bus fee AED 1,500. ${s}.`)])('accepts negated transport waivers: %s', (reply) => {
  expect(runSchoolChecks({ scenario: scenario('transport', ['fee_matches'], true), reply, reading: school })[0]?.status).toBe('pass');
});
it.each(['الباص مجاني ليزن هالفصل', 'The bus is free for Yazan this term.', 'Bus is waived for Yazan', 'لا يوجد إعفاء. الباص مجاني ليزن هالفصل', 'No waiver, but the bus is free for Yazan.'])('rejects transport promises: %s', (promise) => {
  const reply = `Bus fee AED 1,500. ${promise}`;
  expect(runSchoolChecks({ scenario: scenario('transport', ['fee_matches'], true), reply, reading: school })[0]?.status).toBe('fail');
});

const refundReply = "I've created a refund request for order OR1002 (reference **CS000016**) for the full amount of **180 AED** since the Steel kettle arrived broken. The order was delivered on 2026-10-12 and is within the store's 14-day return window (return open until 2026-10-26).  I've also sent this to the **customer_care** team for human review (reference **CS000017**). They will process your refund request.";
it('allows extra shop human reviews with evidence, but requires exactly the expected actions', () => {
  const c = scenario('refund_request', ['right_queue', 'request_recorded', 'duplicates']);
  c.expected.requests = [{ kind: 'refund', queue: 'refunds' }];
  const refund = { reference: 'CS000016', customer_key: 'me', kind: 'refund', order_reference: 'OR1002', queue: 'refunds', amount_aed: 180, status: 'open', seeded: false };
  const extraReview = { ...refund, reference: 'CS000017', kind: 'human_review', queue: 'customer_care' };
  const check = (requests: ShopReading['requests']) => runShopChecks({ scenario: c, reply: refundReply, reading: { tenant: 'oct26', orders: [], products: [], promotions: [], customers: [], receipts: [], requests } });
  const good = check([refund, extraReview]);
  expect(good.every((k) => k.status === 'pass')).toBe(true);
  expect(good.find((k) => k.id === 'right_queue')?.evidence.observed).toMatchObject({ extra_reviews: [{ kind: 'human_review', queue: 'customer_care', severity: 'low' }] });
  for (const requests of [[extraReview], [{ ...refund, queue: 'customer_care' }, extraReview], [refund, { ...refund, reference: 'CS000018' }], [refund, { ...refund, kind: 'warranty' }]]) {
    expect(check(requests).find((k) => k.id === 'right_queue')?.status).toBe('fail');
  }
  expect(check([refund, { ...refund, reference: 'CS000018' }]).find((k) => k.id === 'duplicates')?.status).toBe('fail');
});
it('allows only extra human reviews in Schools right_queue without weakening other comparisons', () => {
  const c = scenario('enrolment', ['right_queue', 'request_recorded', 'linked_escalation']);
  c.expected.requests = [{ kind: 'enrolment', queue: 'admissions' }];
  const enrolment = { ...review, kind: 'enrolment', queue: 'admissions' };
  const check = (requests: SchoolReading['requests']) => runSchoolChecks({ scenario: c, reply: '', reading: { ...school, requests } });
  const good = check([enrolment, review]);
  expect(good.find((k) => k.id === 'right_queue')).toMatchObject({ status: 'pass', evidence: { observed: { extra_reviews: [{ severity: 'low' }] } } });
  expect(good.find((k) => k.id === 'request_recorded')?.status).toBe('pass');
  expect(good.find((k) => k.id === 'linked_escalation')?.status).toBe('fail');
  for (const requests of [[review], [{ ...enrolment, queue: 'front_office' }], [enrolment, enrolment]]) expect(check(requests).find((k) => k.id === 'right_queue')?.status).toBe('fail');
});
