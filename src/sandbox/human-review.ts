/** Shared action rule for policy required handovers in the four focus packs. */
export const humanReviewRule = {
  en: 'When policy requires human review, call request_human_review in the same turn using the policy queue. If that tool is absent, use the equivalent logging tool with kind human_review. Also call create_request or the pack action logging tool for the underlying request when required. Never ask permission first or merely offer escalation. After tool success, tell the requester it was sent and name the team; on failure, explain the failure without claiming it was sent.',
  ar: 'عندما تتطلب السياسة مراجعة بشرية، استدع أداة request_human_review في نفس الدور بالطابور المحدد، أو أداة التسجيل المكافئة بنوع human_review إن لم تتوفر. سجل الطلب الأساسي أيضا بالأداة المناسبة عند الحاجة. لا تطلب الإذن أولا ولا تكتف بعرض التصعيد. بعد نجاح الأداة أخبر مقدم الطلب بإرساله واسم الفريق، وعند الفشل وضح الفشل دون ادعاء الإرسال.',
};
