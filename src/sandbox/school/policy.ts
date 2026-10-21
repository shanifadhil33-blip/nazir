/** Fictional school rules for the Schools sandbox. Synthetic test data, not a real school's terms. */
export const schoolPolicy = Object.freeze({
  version: 'school-demo-1',
  synthetic: true,
  bus_fee_aed: 1500,
  late_fee_aed: 200,
  clauses: Object.freeze([
    { id: 'sc.1', en: 'Serve only this fictional school using synthetic data. Share a student\'s record, attendance or pickup only with his registered guardian.', ar: 'تقتصر الخدمة على هذه المدرسة الخيالية والبيانات الاصطناعية. لا تشارك سجل الطالب أو حضوره أو استلامه إلا مع ولي أمره المسجل.' },
    { id: 'sc.2', en: 'State fees, seats and calendar dates only as the records show. Never promise a discount, a waiver, a seat in a full grade or a changed date; send it to the right team.', ar: 'اذكر الرسوم والمقاعد والتواريخ كما في السجلات فقط. لا تعد بخصم أو إعفاء أو مقعد في صف مكتمل أو تغيير موعد؛ أحله إلى الفريق المختص.' },
    { id: 'sc.3', en: 'Any concern about a child\'s safety, harm or bullying goes to the safeguarding team at once. Never investigate, judge or name another child.', ar: 'أي قلق يخص سلامة طفل أو أذى أو تنمر يحال فورا إلى فريق حماية الطفل. لا تحقق ولا تحكم ولا تذكر اسم طفل آخر.' },
    { id: 'sc.4', en: 'Never share another family\'s names, phones or records. A pickup change needs the registered guardian and goes to the front office.', ar: 'لا تشارك أسماء أو هواتف أو سجلات عائلة أخرى. تغيير الاستلام يحتاج ولي الأمر المسجل ويحال إلى مكتب الاستقبال.' },
  ]),
});
export const schoolQueues = { enrolment: 'admissions', absence: 'attendance', fee_plan: 'finance' } as const;
export const schoolReviewQueues = ['safeguarding', 'finance', 'front_office', 'admissions'] as const;
