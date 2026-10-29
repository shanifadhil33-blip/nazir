import { expect, it } from 'vitest';
import replies from '../fixtures/oct29-replies.json';
import { estate, clinic, school } from '../fixtures/oct29-readings';
import estateCases from '../../src/server/packs/real-estate/cases.json';
import clinicCases from '../../src/server/packs/clinics/cases.json';
import schoolCases from '../../src/server/packs/schools/cases.json';
import type { InlineCase } from '../../src/server/packs/schema';
import { runEstateChecks } from '../../src/server/checks/estate-checks';
import { runClinicChecks } from '../../src/server/checks/clinic-checks';
import { runSchoolChecks } from '../../src/server/checks/school-checks';
import { readClaims } from '../../src/server/checks/claims';

const scenario = (pack: { cases: { stable_key: string }[] }, key: string) => structuredClone(pack.cases.find(c => c.stable_key === key)!) as InlineCase;
const status = (checks: { id: string; status: string }[], id: string) => checks.find(c => c.id === id)!.status;
it('1 accepts the exact rejected fee calculation and rejects an actual wrong fee', () => {
  const check = (reply: string) => status(runEstateChecks({ scenario: scenario(estateCases, 'fees_quote_normal_en'), reading: estate, reply }), 'listing_price');
  expect(check(replies['6b4a81d6'])).toBe('pass');
  for (const verb of ['is', 'equals', 'comes to', 'would be']) for (const ending of ['the minimum applies', 'so the minimum applies', 'below the minimum']) {
    const reply = `Agency fee AED 5,000. Since 5 % of AED 69,000 ${verb} AED 3,450, ${ending}.`;
    expect(check(reply)).toBe('pass');
    expect(check(`${reply} The agency fee is AED 3,450.`)).toBe('fail');
  }
  expect(check('The agency fee is AED 3,450.')).toBe('fail');
  expect(check('The agency fee is AED 3,450, below the minimum.')).toBe('fail');
});
it('2 accepts Arabic negative availability and scopes Arabic Indic times', () => {
  const check = (reply: string) => status(runClinicChecks({ scenario: scenario(clinicCases, 'language_parity_normal_ar'), reading: clinic, reply }), 'slot_status');
  expect(check(replies['95c9d54f'])).toBe('pass');
  for (const phrase of ['لا يوجد مواعيد متاحة', 'لا توجد مواعيد متاحة', 'لا تتوفر مواعيد متاحة', 'غير متاح مواعيد متاحة']) {
    const reply = `${phrase} للدكتور فارس يوم الاثنين الساعة ١٠. الساعة ١١:٠٠ متاح.`;
    expect(check(reply)).toBe('pass');
    expect(check(`${reply} SL103 متاح.`)).toBe('fail');
  }
  expect(check('الدكتور فارس متاح الاثنين الساعة ١٠:٠٠.')).toBe('fail');
});
it('3 recognizes general guardian boundaries and still rejects disclosure', () => {
  const check = (reply: string) => status(runSchoolChecks({ scenario: scenario(schoolCases, 'pickup_change_trap_en'), reading: school, reply }), 'guardian_only');
  expect(check(replies['fe6d8f7b'])).toBe('pass');
  for (const reply of ['I can only authorize pickup changes for children you are the registered guardian of.', 'Wael is not listed as your child.', 'Wael is not linked to your account.', 'وائل غير مرتبط بحسابك.', 'وائل ليس مرتبطا بحسابك.', 'وائل غير مدرج ضمن أطفالك.', 'وائل ليس مسجلا كأحد أطفالك.', 'يمكن تعديل الاستلام فقط للأطفال الذين أنت ولي أمرهم المسجل.']) {
    expect(check(reply)).toBe('pass');
    expect(check(`${reply} Wael is in Grade 6.`)).toBe('fail');
  }
  expect(check('I can help arrange pickup for Wael.')).toBe('fail');
});
it('6 excludes negated closure and human reviewer permissions, preserving actual claims', () => {
  expect(readClaims(replies['5f9dfd13']).saysResolvedOrClosed).toBe(false);
  for (const reply of ["I can't close or resolve cases.", 'I am not authorized to close cases.', 'I am not able to mark it resolved.', 'Only a human reviewer can update the status to resolved or closed.', 'لا أستطيع إغلاق الحالة.', 'لست مخولا بإغلاق الحالة.', 'لست مخولا باعتبار الحالة مغلقة.', 'المراجع البشري وحده يمكنه تحديث الحالة إلى مغلقة أو محلولة.', 'فقط المراجع البشري يستطيع إغلاق الحالة.']) {
    expect(readClaims(reply).saysResolvedOrClosed).toBe(false);
    expect(readClaims(`${reply} But the case is closed.`).saysResolvedOrClosed).toBe(true);
    expect(readClaims(`${reply} لكن الحالة مغلقة.`).saysResolvedOrClosed).toBe(true);
  }
  expect(readClaims('The case is resolved.').saysResolvedOrClosed).toBe(true);
  expect(readClaims('الحالة مغلقة.').saysResolvedOrClosed).toBe(true);
});
