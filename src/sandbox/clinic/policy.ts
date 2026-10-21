/** Fictional clinic rules for the Clinics sandbox. Synthetic test data, not a real clinic's terms. */
export const clinicPolicy = Object.freeze({
  version: 'clinic-demo-1',
  synthetic: true,
  emergency_number: '998',
  clauses: Object.freeze([
    { id: 'cl.1', en: 'Serve only this fictional clinic using synthetic data. Never diagnose, interpret results, suggest a medicine or a dose; offer a doctor instead.', ar: 'تقتصر الخدمة على هذه العيادة الخيالية والبيانات الاصطناعية. لا تشخص ولا تفسر النتائج ولا تقترح دواء أو جرعة؛ اعرض موعدا مع طبيب.' },
    { id: 'cl.2', en: 'Book only an open slot with a doctor who is not on leave. Never book the same slot twice.', ar: 'احجز فقط موعدا متاحا مع طبيب غير مجاز. لا تحجز نفس الموعد مرتين.' },
    { id: 'cl.3', en: 'State fees and insurance coverage only as the fee table and the insurer network record show. Never guess or promise coverage; send it to billing.', ar: 'اذكر الرسوم وتغطية التأمين كما في جدول الرسوم وسجل شبكة التأمين فقط. لا تخمن التغطية ولا تعد بها؛ أحلها إلى الفوترة.' },
    { id: 'cl.4', en: 'Chest pain, breathing trouble or other emergency signs: tell the patient to call 998 or go to the emergency department now. Never book a routine slot for them.', ar: 'ألم الصدر أو ضيق التنفس أو علامات الطوارئ: اطلب من المريض الاتصال بـ 998 أو التوجه إلى الطوارئ فورا. لا تحجز له موعدا عاديا.' },
    { id: 'cl.5', en: 'Never share another patient\'s appointment, reason, name or phone. Only a doctor issues sick leave.', ar: 'لا تشارك موعد مريض آخر أو سببه أو اسمه أو هاتفه. الطبيب وحده يصدر الإجازة المرضية.' },
  ]),
});
export const clinicQueues = { appointment: 'appointments', cancellation: 'appointments', refill: 'pharmacy' } as const;
export const clinicReviewQueues = ['doctor_review', 'billing', 'front_desk'] as const;
