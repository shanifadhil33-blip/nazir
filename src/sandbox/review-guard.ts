import { hash } from './demo-rule-pack';
import type { Message } from './agent';
import type { ToolResult } from './tools';

export type AgentToolEvent = { name: string; arguments: unknown; result: ToolResult; guard?: true };
type Pack = 'clinic' | 'shop' | 'school' | 'estate';
type Rule = { queue: string; en: string; ar: string; intent: RegExp };
/** Policy queues: cl.1/3/6, ec.2/4, sc.2/3/4, re.5/8.
 * Match requests for intervention, not general questions about published rules.
 * Priority matters: safety and legal concerns precede money matters.
 */
export const reviewGuardRules: Record<Pack, readonly Rule[]> = {
  clinic: [
    { queue: 'doctor_review', en: 'doctor review team', ar: 'فريق مراجعة الطبيب', intent: /lab results|blood (?:test|results)|interpret.*results|tell me if I am sick|نتائج.*(?:تحاليل|تحليل|التحليل|الفحص)|(?:قل|قول).*إذا.*مريض|اقرا.*الأرقام|(?:فسر|تفسير).*نتائج|(?:critical|urgent).*refill|تجديد.*(?:عاجل|حرج)/i },
    { queue: 'billing', en: 'billing team', ar: 'فريق الفوترة', intent: /(?:promise|guarantee|approve).*(?:coverage|insurance)|discount|waiv|lower.*fee|(?:اضمن|تضمن|أكد|اكد|اوعدني|وعدني|توعدني).*(?:تغطية|التأمين)|(?:consultation|visit|appointment|fee)\b[^.!?\n]*\bfor\s+(?:AED\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*AED)\b|(?:كشف|استشارة|زيارة|موعد)[^.!؟\n]*ب[ـ]?\s*[0-9٠-٩]+(?:[.٫][0-9٠-٩]+)?\s*درهم|خصم|إعفاء|اعفاء|خفض.*رسوم/i },
    { queue: 'front_desk', en: 'front desk team', ar: 'فريق الاستقبال', intent: /(?:file|make|submit|raise).*(?:complaint)|(?:أقدم|اقدم|تقديم|سجل).*شكوى/i },
  ],
  shop: [
    { queue: 'customer_care', en: 'customer care team', ar: 'فريق خدمة العملاء', intent: /(?:1[5-9]|[2-9]\d|١[٥-٩]|[٢-٩][٠-٩])\s*(?:days?|يوم).*(?:return|إرجاع|ارجاع)|refund|warranty|رجع لي.*المبلغ|(?:return|send.*back).*(?:late|expired|outside|window.*(?:closed|ended))|(?:أرجع|ارجع|إرجاع|ارجاع|ترجيع).*(?:انته|مهلة|فات|متأخر)|(?:انته|فات).*مهلة.*(?:إرجاع|ارجاع)|استرجاع|استرداد|ضمان/i },
    { queue: 'payments', en: 'payments team', ar: 'فريق المدفوعات', intent: /(?:charged|paid|debited).*(?:twice|double)|payment (?:problem|issue|failed)|(?:انخصم|خصموا|سحبوا|دفعت).*(?:مرتين|مكرر)|مشكلة.*(?:دفع|الدفع)/i },
    { queue: 'pricing', en: 'pricing team', ar: 'فريق التسعير', intent: /price match|match.*price|discount|(?:make|create).*code|مطابقة.*سعر|طابق.*سعر|خصم/i },
  ],
  school: [
    { queue: 'safeguarding', en: 'safeguarding team', ar: 'فريق حماية الطفل', intent: /bully|bullied|bullying|child.*(?:harm|unsafe|safety)|تنمر|سلامة.*طفل|(?:طفل|ابن|ولد).*(?:أذى|اذى|خطر|ضرب)/i },
    { queue: 'finance', en: 'finance team', ar: 'فريق المالية', intent: /discount|waiv|fee plan|instalment|installment|خصم|إعفاء|اعفاء|تقسيط|أقساط|اقساط|(?:أدفع|ادفع|رسوم).*دفعات/i },
    { queue: 'admissions', en: 'admissions team', ar: 'فريق القبول', intent: /(?:reserve|book|enrol).*full (?:grade|class)|(?:احجز|حجز|سجل).*(?:صف|الصف).*(?:مكتمل|ممتلئ)/i },
    { queue: 'front_office', en: 'front office team', ar: 'فريق مكتب الاستقبال', intent: /(?:change|different|someone else).*pick.?up|(?:تغيير|غير|بدل).*استلام/i },
  ],
  estate: [
    { queue: 'legal_review', en: 'legal review team', ar: 'فريق المراجعة القانونية', intent: /(?:my (?:Dubai )?landlord|my tenant).*(?:evict|dispute|eviction notice)|(?:evict|dispute).*(?:me|my)|(?:المالك|المؤجر).*(?:إخلاء|اخلاء|أطلع|اطلع|نزاع)|نزاع.*(?:إيجار|ايجار)/i },
    { queue: 'accounts', en: 'accounts team', ar: 'فريق الحسابات', intent: /(?:refund|return).*(?:my|deposit)|(?:my|deposit).*refund|bounced cheque|change.*payment|(?:وافق|رد|استرجاع|استرداد).*تأمين|شيك.*(?:مرتجع|رجع)|تغيير.*(?:دفع|دفعات)/i },
    { queue: 'leasing', en: 'leasing team', ar: 'فريق التأجير', intent: /discount|negotiat.*(?:rent|commission)|خصم|تفاوض.*(?:إيجار|ايجار|عمولة)/i },
  ],
};
/** Request-filing tools inspected in each pack's tool manifest and executor.
 * Explicit kinds prevent a reader or an unknown create_request kind from
 * suppressing the safety net. Bookings, enrolments and absences are not team
 * routing, so they never stand in for a policy required review.
 */
export const teamRoutingRequests = {
  clinic: { tools: [], createRequestKinds: ['refill', 'human_review'] },
  shop: { tools: ['request_human_review'], createRequestKinds: ['refund', 'address_change', 'cancellation', 'warranty', 'missing_item'] },
  school: { tools: ['request_fee_plan', 'request_human_review'], createRequestKinds: [] },
  estate: { tools: ['create_maintenance_request', 'request_human_review'], createRequestKinds: [] },
} as const satisfies Record<Pack, { tools: readonly string[]; createRequestKinds: readonly string[] }>;
export const reviewGuardHash = hash({ revision: 2, teamRoutingRequests, rules: Object.fromEntries(Object.entries(reviewGuardRules).map(([pack, rules]) => [pack, rules.map((r) => ({ ...r, intent: r.intent.source }))])) });
export function isReviewEvent(call: Pick<AgentToolEvent, 'name' | 'arguments' | 'result'>): boolean {
  if (!call.result.ok) return false;
  const kind = (call.arguments as { kind?: string } | null)?.kind;
  return Object.values(teamRoutingRequests).some((routing) =>
    (routing.tools as readonly string[]).includes(call.name)
    || call.name === 'create_request' && typeof kind === 'string' && (routing.createRequestKinds as readonly string[]).includes(kind));
}
/** Executed only by the demo agent, with its own tools and turn-local events. */
export async function finishWithReviewGuard(input: {
  pack: Pack; enabled: boolean; reply: string; messages: Message[]; transcript: Message[]; toolCalls: AgentToolEvent[]; conversationKey: string;
  tools: { execute(name: string, args: unknown, options: { idempotencyKey: string; guard?: boolean }): Promise<ToolResult> };
}) {
  const { transcript, toolCalls } = input;
  const latest = input.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  const rule = input.enabled && !toolCalls.some(isReviewEvent) ? reviewGuardRules[input.pack].find((r) => r.intent.test(latest)) : undefined;
  let reply = input.reply;
  if (rule) {
    const name = input.pack === 'clinic' ? 'create_request' : 'request_human_review';
    const reason = `Automatic review (guard): ${latest.slice(0, 1800)}`;
    const args = input.pack === 'clinic' ? { kind: 'human_review', queue: rule.queue, summary: reason } : {
      queue: rule.queue, reason,
      ...(input.pack === 'shop' && /\bOR\d{4}\b/.test(latest) ? { order_reference: latest.match(/\bOR\d{4}\b/)![0] } : {}),
      ...(input.pack === 'estate' && /\bRE\d{4}\b/.test(latest) ? { unit: latest.match(/\bRE\d{4}\b/)![0] } : {}),
      // Pickup tools enforce guardian ownership. Use only a child already verified
      // by this agent's successful read, never infer or fetch it as the judge.
      ...(input.pack === 'school' && rule.queue === 'front_office' ? { student: toolCalls.filter((c) => c.name === 'get_student' && c.result.ok).map((c) => c.result.ok ? c.result.data.name : undefined).at(-1) } : {}),
    };
    let result: ToolResult;
    try { result = await input.tools.execute(name, args, { idempotencyKey: `${input.conversationKey}:${name}:${hash(args)}`, guard: true }); }
    catch { result = { ok: false, error: 'tool_failed' }; }
    toolCalls.push({ name, arguments: args, result, guard: true });
    // Keep the initiated call visible in the transcript as well as tool events.
    const id = `guard_${toolCalls.length}`;
    transcript.push({ role: 'assistant', content: null, tool_calls: [{ id, name, arguments: JSON.stringify(args) }] });
    transcript.push({ role: 'tool', tool_call_id: id, content: JSON.stringify({ ...result, guard: true, source: 'guard' }) });
    if (result.ok) {
      const reference = typeof result.data.reference === 'string' ? ` (${result.data.reference})` : '';
      reply += /[\u0600-\u06ff]/.test(reply)
        ? ` أرسلت طلبك إلى ${rule.ar}${reference}.`
        : ` I sent your request to the ${rule.en}${reference}.`;
    }
    transcript.push({ role: 'assistant', content: reply });
  }
  return { reply, transcript, toolCalls };
}
