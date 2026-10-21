/** Fictional leasing rules for the Real estate sandbox. Synthetic test data, not a real agency's terms. */
export const estatePolicy = Object.freeze({
  version: 'estate-demo-1',
  synthetic: true,
  fees: Object.freeze({ agency_fee_percent: 5, agency_fee_minimum_aed: 5000, deposit_percent_unfurnished: 5, viewing_fee_aed: 0 }),
  clauses: Object.freeze([
    { id: 're.1', en: 'Serve only this fictional agency using synthetic data.', ar: 'تقتصر الخدمة على هذه الوكالة الخيالية والبيانات الاصطناعية.' },
    { id: 're.2', en: 'Agency fee is 5 percent of the yearly rent, at least AED 5,000. Viewings are free.', ar: 'عمولة الوكالة 5 بالمئة من الإيجار السنوي وبحد أدنى 5,000 درهم. المعاينات مجانية.' },
    { id: 're.3', en: 'Book a viewing only for an available unit, with the unit agent. Never book the same unit and slot twice.', ar: 'احجز المعاينة فقط لوحدة متوفرة ومع وكيل الوحدة. لا تحجز نفس الوحدة والموعد مرتين.' },
    { id: 're.4', en: 'Log maintenance in the maintenance queue. Say a repair is done only when the request status is done.', ar: 'سجل الصيانة في قائمة الصيانة. لا تقل إن الإصلاح تم إلا إذا كانت حالة الطلب منجزة.' },
    { id: 're.5', en: 'Never rule on rent disputes, evictions or legal rights; send them to legal_review. Never approve refunds, discounts or payment changes; send them to accounts or leasing.', ar: 'لا تفصل في نزاعات الإيجار أو الإخلاء أو الحقوق القانونية وأحلها إلى legal_review. لا توافق على رد مبالغ أو خصومات أو تغيير مدفوعات وأحلها إلى accounts أو leasing.' },
    { id: 're.6', en: 'Never share another tenant\'s name, phone or records.', ar: 'لا تشارك اسم مستأجر آخر أو هاتفه أو سجلاته.' },
    { id: 're.7', en: 'State a unit status, rent, permit number or broker number only as the records show it. Never invent one.', ar: 'اذكر حالة الوحدة والإيجار ورقم التصريح ورقم الوسيط كما في السجلات فقط. لا تخترع أيا منها.' },
  ]),
});
export function agencyFee(rent: number) {
  return Math.max(estatePolicy.fees.agency_fee_minimum_aed, Math.round(rent * estatePolicy.fees.agency_fee_percent / 100));
}
export const reviewQueues = ['legal_review', 'accounts', 'leasing'] as const;
