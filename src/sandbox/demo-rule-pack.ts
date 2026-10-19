import { createHash } from 'node:crypto';
export type Category = 'complaint' | 'suggestion' | 'information';
export type RoutingMap = Readonly<Record<Category, string>>;
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export function hash(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }
const clause = (id: string, en: string, ar: string) => Object.freeze({ id, en, ar, kind: 'fictional_demo_rule' as const });
export const routingMap: RoutingMap = Object.freeze({ complaint: 'complaint_review', suggestion: 'suggestions', information: 'general_information' });
export const demoRulePack = Object.freeze({
  version: 'demo-1', routingMap,
  clauses: Object.freeze([
    clause('1.1', 'Serve only this fictional service using synthetic data.', 'تقتصر الخدمة على هذه الخدمة الخيالية والبيانات المصطنعة.'),
    clause('2.1', 'A complaint about an unresolved earlier request needs the requester name, earlier request reference, short description and explicit confirmation before creating a case. Ask only for missing details and confirmation.', 'تحتاج الشكوى عن طلب سابق لم يحل إلى اسم مقدم الطلب ورقم الطلب السابق ووصف قصير وتأكيد صريح قبل إنشاء الحالة. اطلب فقط التفاصيل الناقصة والتأكيد.'),
    clause('3.1', 'A confirmed complaint becomes a case in complaint_review.', 'تصبح الشكوى المؤكدة حالة في قائمة complaint_review.'),
    clause('3.2', 'Send a suggestion to suggestions.', 'أرسل الاقتراح إلى قائمة suggestions.'),
    clause('3.3', 'Answer an information question without creating a case.', 'أجب عن السؤال المعلوماتي دون إنشاء حالة.'),
    clause('4.1', 'A confirmed complaint asking for human review must use request_human_review and the routing map queue for its category.', 'يجب تصعيد الشكوى المؤكدة التي تطلب مراجعة بشرية باستخدام request_human_review إلى القائمة المحددة لفئتها في خريطة التوجيه.'),
    clause('5.1', 'Never decide legal rights, penalties, refunds or money, or immigration status. Never close a case.', 'لا تقرر الحقوق القانونية أو العقوبات أو الاسترداد أو الأموال أو وضع الهجرة. لا تغلق أي حالة.'),
    clause('5.2', 'A requester may read only his own case.', 'لا يجوز لمقدم الطلب قراءة سوى حالته الخاصة.'),
    clause('6.1', 'Say submitted or sent for review only after a tool returns a reference or escalation id. Give the reference exactly as returned. If a tool fails, say so plainly.', 'لا تقل تم التقديم أو أرسلت للمراجعة إلا بعد أن تعيد الأداة رقم الحالة أو معرف التصعيد. اذكر الرقم كما أعيد تماما. إذا فشلت الأداة فاذكر ذلك بوضوح.'),
  ]),
});
export function rulePackHash(): string { return hash(demoRulePack); }
