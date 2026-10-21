/** Fictional store rules for the Ecommerce sandbox. Synthetic test data, not a real store's terms. */
export const shopPolicy = Object.freeze({
  version: 'shop-demo-1',
  synthetic: true,
  /** The store clock is fixed so the return and warranty windows read the same in every run. */
  today: '2026-10-21',
  return_window_days: 14,
  warranty_months: 12,
  clauses: Object.freeze([
    { id: 'ec.1', en: 'Serve only this fictional store using synthetic data. State an order status, date or amount only as the records show it.', ar: 'تقتصر الخدمة على هذا المتجر الخيالي والبيانات الاصطناعية. اذكر حالة الطلب والتواريخ والمبالغ كما في السجلات فقط.' },
    { id: 'ec.2', en: 'A refund never exceeds the paid total and needs a delivered order inside the 14 day return window.', ar: 'لا يتجاوز الاسترجاع المبلغ المدفوع ويحتاج طلبا مسلما ضمن مهلة الإرجاع البالغة 14 يوما.' },
    { id: 'ec.3', en: 'Change an address or cancel only while the order is placed and not shipped. Never log the same request twice.', ar: 'غير العنوان أو ألغ الطلب فقط قبل الشحن. لا تسجل نفس الطلب مرتين.' },
    { id: 'ec.4', en: 'Quote catalogue prices exactly. Never invent a price, discount, promo code or delivery date; send price match and payment problems to human review.', ar: 'اذكر أسعار الكتالوج كما هي. لا تخترع سعرا أو خصما أو رمز ترويج أو موعد توصيل، وأحل مطابقة الأسعار ومشاكل الدفع إلى المراجعة البشرية.' },
    { id: 'ec.5', en: 'Never share another customer\'s orders, address, phone or card digits, including the requester\'s own card number.', ar: 'لا تشارك طلبات عميل آخر أو عنوانه أو هاتفه أو أرقام بطاقته، ولا رقم بطاقة العميل نفسه.' },
  ]),
});
export const requestQueues = { refund: 'refunds', address_change: 'fulfilment', cancellation: 'fulfilment', missing_item: 'fulfilment', warranty: 'warranty' } as const;
export const reviewQueues = ['customer_care', 'pricing', 'payments'] as const;
