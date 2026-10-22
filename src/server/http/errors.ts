import { ZodError } from 'zod';

/** One plain line per code, in English and Modern Standard Arabic. */
export const errorLines = {
  external_private_address: { en: 'This link points to a private or local address, so Nazir will not call it for safety.', ar: 'يشير هذا الرابط إلى عنوان خاص أو محلي، لذلك لن يتصل به ناظر حفاظا على الأمان.' },
  external_safety: { en: 'The connection was refused by the safety check. Use a public HTTPS address on port 443 without redirects.', ar: 'رفض فحص الأمان الاتصال. استخدم عنوان HTTPS عاما على المنفذ 443 دون إعادة توجيه.' },
  external_timeout: { en: 'The agent took too long to reply. Try again.', ar: 'استغرق الوكيل وقتا طويلا للرد. أعد المحاولة.' },
  external_unreachable: { en: 'The agent could not be reached. Check the link and access key.', ar: 'تعذر الوصول إلى الوكيل. تحقق من الرابط ومفتاح الوصول.' },
  external_format: { en: 'The reply format was not accepted or the response exceeded 64 KB.', ar: 'لم تقبل صيغة الرد أو تجاوز حجم الاستجابة 64 كيلوبايت.' },
  external_rate_limit: { en: 'This workspace has sent 20 test messages in the past hour. Try again later.', ar: 'أرسلت مساحة العمل 20 رسالة اختبار خلال الساعة الماضية. أعد المحاولة لاحقا.' },
  external_changed: { en: 'The connection changed. Save it and send a test message again.', ar: 'تغير الاتصال. احفظه وأرسل رسالة اختبار مجددا.' },
  external_not_ready: { en: 'Send a successful test message before running tests on this connection.', ar: 'أرسل رسالة اختبار ناجحة قبل تشغيل الاختبارات على هذا الاتصال.' },
  unauthorized: { en: 'Please sign in to continue.', ar: 'يرجى تسجيل الدخول للمتابعة.' },
  token_invalid: { en: 'The token is no longer valid.', ar: 'لم يعد الرمز صالحا.' },
  forbidden: { en: 'Your role cannot do this.', ar: 'دورك لا يسمح بهذا.' },
  not_demo: { en: 'This workspace is not a demo.', ar: 'مساحة العمل هذه ليست للعرض.' },
  pack_not_running: { en: 'Test runs for this focus pack are not open yet. It is still a draft; pick a live pack to run tests.', ar: 'تشغيلات الاختبار لهذه الحزمة غير متاحة بعد. ما زالت مسودة؛ اختر حزمة متاحة لتشغيل الاختبارات.' },
  live_test_government_only: { en: 'The live complaint test uses the Government pack. Run this pack from a test plan instead.', ar: 'يستخدم اختبار الشكوى المباشر حزمة الخدمات الحكومية. شغل هذه الحزمة من خطة اختبار بدلا من ذلك.' },
  too_many: { en: 'You have reached the limit for now.', ar: 'بلغت الحد المسموح حاليا.' },
  workspace_limit: { en: 'You can belong to at most 10 workspaces. Remove one to add another.', ar: 'يمكنك الانتماء إلى عشر مساحات عمل على الأكثر. أزل واحدة لتضيف غيرها.' },
  not_found: { en: 'The record was not found.', ar: 'لم يعثر على السجل.' },
  validation: { en: 'Check the details and try again.', ar: 'تحقق من التفاصيل ثم أعد المحاولة.' },
  internal_error: { en: 'Something went wrong.', ar: 'حدث خلل ما.' },
  approval_required: { en: 'An exact approval from an allowed role is required.', ar: 'تلزم موافقة صريحة من دور مسموح له.' },
  four_eyes: { en: 'Another member must decide.', ar: 'يجب أن يقرر عضو آخر.' },
  not_waiting: { en: 'The plan is not waiting for a decision.', ar: 'الخطة ليست بانتظار قرار.' },
  not_approved: { en: 'An approved plan is required.', ar: 'تلزم خطة معتمدة.' },
  not_finished: { en: 'Both runs must be finished.', ar: 'يجب أن يكون التشغيلان منتهيين.' },
  same_run: { en: 'Two different runs are needed.', ar: 'يلزم تشغيلان مختلفان.' },
  version: { en: 'The agent version cannot be tested.', ar: 'لا يمكن اختبار نسخة الوكيل هذه.' },
  unknown_version: { en: 'Unknown agent version.', ar: 'نسخة الوكيل غير معروفة.' },
  impersonation: { en: 'You cannot act as another member.', ar: 'لا يمكنك أن تتصرف بصفة عضو آخر.' },
  failed: { en: 'The action was not completed.', ar: 'لم يتم تنفيذ الإجراء.' },
  invalid_patch: { en: 'That repair is not allowed.', ar: 'هذا الإصلاح غير مسموح.' },
  repeat_budget: { en: 'The repeated tests exceed the plan call budget. Choose fewer attempts or fewer tests.', ar: 'تتجاوز الاختبارات المتكررة ميزانية مكالمات الخطة. اختر محاولات أقل أو اختبارات أقل.' },
  repeat_daily_cap: { en: 'The repeated tests exceed the remaining daily call limit. Choose fewer attempts or fewer tests.', ar: 'تتجاوز الاختبارات المتكررة حد المكالمات اليومي المتبقي. اختر محاولات أقل أو اختبارات أقل.' },
  budget_too_small: { en: 'The budget is too small for a test.', ar: 'الميزانية أصغر من أن تكفي لاختبار.' },
  widens_tools: { en: 'A plan cannot add tools.', ar: 'لا يمكن للخطة أن تضيف أدوات.' },
  widens_permissions: { en: 'A plan cannot add permissions.', ar: 'لا يمكن للخطة أن تضيف صلاحيات.' },
  no_tests: { en: 'There is no approved test to plan.', ar: 'لا يوجد اختبار معتمد لوضع خطة.' },
  effect_not_allowed: { en: 'I cannot remember that kind of change.', ar: 'لا أستطيع تذكر هذا النوع من التغيير.' },
  changes_expected_result: { en: 'A lesson cannot change the approved expected queue.', ar: 'لا يمكن للدرس أن يغير الطابور المتوقع المعتمد.' },
  lesson_role: { en: 'Your role cannot change what I have learned.', ar: 'دورك لا يسمح بتغيير ما تعلمته.' },
  lesson_not_found: { en: 'I could not find that lesson.', ar: 'لم أجد هذا الدرس.' },
  lesson_state: { en: 'That lesson cannot change this way now.', ar: 'لا يمكن تغيير هذا الدرس بهذه الطريقة الآن.' },
  live_test_unavailable: { en: 'The live test is not connected here yet. Nothing was queued.', ar: 'الاختبار المباشر غير متصل هنا بعد. لم يوضع شيء في الطابور.' },
  live_test_demo_only: { en: 'The live test runs in demo workspaces only.', ar: 'يعمل الاختبار المباشر في مساحات العرض فقط.' },
} as const;
export type ErrorCode = keyof typeof errorLines;
export type CallerLanguage = 'en' | 'ar';
const arabic = /[\u0600-\u06FF]/;

export function callerLanguage(input: { header?: string | null; message?: string | null } = {}): CallerLanguage {
  if (input.message && arabic.test(input.message)) return 'ar';
  const header = (input.header ?? '').toLowerCase();
  if (/(^|,)\s*ar\b/.test(header)) return 'ar';
  return 'en';
}
export function messageFor(code: string, language: CallerLanguage = 'en', details?: { attempts: number; estimatedCalls: number }) {
  const line = (errorLines as Record<string, { en: string; ar: string }>)[code] ?? errorLines.failed;
  if (details && (code === 'repeat_budget' || code === 'repeat_daily_cap')) {
    const estimate = language === 'ar' ? `عدد المحاولات ${details.attempts} والمكالمات المقدرة ${details.estimatedCalls}.` : `${details.attempts} attempts with ${details.estimatedCalls} estimated calls.`;
    return `${line[language]} ${estimate}`;
  }
  return line[language];
}

export class Unauthorized extends Error {
  constructor() { super(errorLines.unauthorized.en); this.name = 'Unauthorized'; }
}
export class Forbidden extends Error {
  constructor() { super(errorLines.forbidden.en); this.name = 'Forbidden'; }
}
export class TooMany extends Error {
  constructor(message: string = errorLines.too_many.en) { super(message); this.name = 'TooMany'; }
}
export class NotFound extends Error {
  constructor() { super(errorLines.not_found.en); this.name = 'NotFound'; }
}
/** A refusal with a stable code and one plain sentence. */
export class Coded extends Error {
  constructor(public status: number, public code: string, message: string, public details?: { attempts: number; estimatedCalls: number }) { super(details ? messageFor(code, 'en', details) : message); this.name = 'Coded'; }
}
export function mapError(error: unknown, language: CallerLanguage = 'en') {
  const body = (code: string, status: number) => ({ status, body: { error: { code, message: messageFor(code, language, error instanceof Coded ? error.details : undefined) } } });
  if (error instanceof Unauthorized) return body('unauthorized', 401);
  if (error instanceof Forbidden) return body('forbidden', 403);
  if (error instanceof TooMany) return body(error.message.includes('workspaces') ? 'workspace_limit' : 'too_many', 429);
  if (error instanceof NotFound) return body('not_found', 404);
  if (error instanceof Coded) return body(error.code in errorLines ? error.code : 'failed', error.status);
  if (error instanceof ZodError && error.issues.some((i) => i.message === 'external_private_address')) return body('external_private_address', 400);
  if (error instanceof ZodError && error.issues.some((i) => i.message === 'external_safety')) return body('external_safety', 400);
  if (error instanceof ZodError || error instanceof SyntaxError) return body('validation', 400);
  return body('internal_error', 500);
}
export function errorResponse(error: unknown, language: CallerLanguage = 'en'): Response {
  const result = mapError(error, language);
  return Response.json(result.body, { status: result.status });
}
