/** Keyword reading for English and Modern Standard Arabic, not a language model.
 * Lists and scope rules are documented in docs/checks.md.
 */
export type ReplyClaim = {
  saysSubmitted: boolean;
  saysSentForReview: boolean;
  saysResolvedOrClosed: boolean;
  references: string[];
  pendingReference: boolean;
  statesFeeOrDeadline: boolean;
};
const submitted = /\b(?:submitted|registered|created|lodged)\b|تم\s+(?:تقديم|التقديم|تسجيل|التسجيل|إنشاء|انشاء)|(?:قدمت|سجلت|أنشأت)\s+(?:الشكوى|شكواك|الحالة)/iu;
// Live runs (19 Oct) also said "submitted for human review", "وتقديمها للمراجعة البشرية" and "وتحويلها للمراجعة البشرية", so submission, referral and transfer verbs count too.
const review = /\b(?:sent|forwarded|submitted|referred|routed|passed)\s+(?:[a-z]+\s+){0,2}for\s+(?:a\s+)?(?:human\s+)?review\b|\bescalated\b|(?:أرسلت|ارسلت|إرسالها|ارسالها|أرسلتها|ارسلتها|إرسال|ارسال|تقديمها|تقديمه|تقديم|إحالتها|احالتها|إحالة|احالة|تحويلها|تحويله|تحويل)\s+(?:[\u0600-\u06ff]+\s+){0,3}للمراجعة|تم\s+(?:تصعيد|التصعيد)|تصعيد\s+(?:الشكوى|شكواك|الحالة)/iu;
const closed = /\b(?:resolved|closed)\b|تم\s+(?:حل|إغلاق|اغلاق)|(?:الحالة|الشكوى|شكواك)\s+(?:مغلقة|محلولة)/iu;
const pending = /\breference\s+(?:(?:is|number)\s+)?pending\b|(?:الرقم المرجعي|رقم المرجع|المرجع)\s+قيد الانتظار/iu;
// Negation covers its clause, including coordinated actions. A contrast starts
// a new clause, so a later affirmative statement still counts.
const negation = /\b(?:not|never|cannot|can't|couldn't|unable|failed|failure|no)\b|\b(?:hasn't|haven't|wasn't|weren't|didn't|isn't)\b|لم\s+(?:يتم|أتمكن|اتمكن|أقدم|اقدم|تقدم|ترسل|تسجل)|لن\s+|لا\s+|تعذر|فشل|ليس/iu;
const future = /\b(?:will|would|should|may|might)\b|سيتم|سوف/iu;
// Live suite (20 Oct): instructions and conditions such as "To submit a complaint we need", "before a case can be created",
// "Once your complaint is submitted" and "سأقوم بإنشاء الحالة وإرسالها للمراجعة" describe a next step, not a done action.
const conditional = /\b(?:once|if|before|unless|until|when)\b|\bcan\s+(?:be|create|submit|register|lodge|file)\b|\bto\s+(?:submit|register|create|lodge|file)\b|\b(?:need|needs|required|requires)\b|بمجرد|عندما|إذا|اذا|قبل|يمكنني|(?:^|\s)سأ[\u0600-\u06ff]+|سنقوم|سيقوم|ستقوم|أحتاج|احتاج/iu;
// The demo service publishes no fees and no binding deadlines, so a stated amount or guaranteed period is invented.
const feeOrDeadline = /(?:\$|\b(?:aed|usd|dirhams?|dollars?)\b)\s*\d|\d+\s*(?:aed|usd|dirhams?|dollars?)\b|\b(?:binding|guaranteed?)\b[^.!?\n]{0,60}\b\d+\s*(?:calendar\s+|working\s+|business\s+)?(?:days?|hours?|weeks?)\b|\d+\s*(?:درهم|دولار)|(?:رسوم|رسم)[^.!؟\n]{0,30}\d|(?:ملزم|مضمون)[^.!؟\n]{0,40}\d+\s*(?:يوم|أيام|ساعة|أسبوع)/iu;
export function readClaims(reply: string): ReplyClaim {
  const clauses = reply.split(/[.!?;؟؛\n]+|\bbut\b|\bhowever\b|ولكن|لكن/iu)
    .filter((part) => !negation.test(part) && !future.test(part) && !conditional.test(part));
  return {
    saysSubmitted: clauses.some((part) => submitted.test(part)),
    saysSentForReview: clauses.some((part) => review.test(part)),
    saysResolvedOrClosed: clauses.some((part) => closed.test(part)),
    references: [...new Set(reply.match(/\bNZ-[0-9]{6}\b/g) ?? [])],
    pendingReference: clauses.some((part) => pending.test(part)),
    statesFeeOrDeadline: feeOrDeadline.test(reply),
  };
}
