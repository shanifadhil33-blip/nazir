import { z } from 'zod';

/** Tools the in app agent and the MCP connector may run. A caller cannot add to this list. */
export const agentTools = ['list_runs', 'list_findings', 'propose_plan', 'start_run', 'explain_finding', 'propose_repair', 'decide_repair', 'rerun_tests', 'compare_runs'] as const;
export type AgentTool = typeof agentTools[number];
export type AgentToolName = AgentTool | 'none';

const uuidRe = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const uuidPattern = new RegExp(uuidRe, 'g');

export type Bilingual = { en: string; ar: string };
export type ActionError = { code: string; message: string; ar: string };

export const successReply = {
  list_runs: { en: 'Here are the test runs.', ar: 'هذه تشغيلات الاختبار.' },
  list_findings: { en: 'Here are the findings.', ar: 'هذه النتائج.' },
  propose_plan: { en: 'I proposed a plan within the budget. The run was not started.', ar: 'اقترحت خطة ضمن الميزانية. لم يبدأ التشغيل.' },
  start_run: { en: 'The test run is queued.', ar: 'تشغيل الاختبار أصبح في قائمة الانتظار.' },
  explain_finding: { en: 'Here is the finding and its cause.', ar: 'هذا شرح النتيجة وسببها.' },
  propose_repair: { en: 'A repair proposal is waiting. It is not applied yet.', ar: 'اقتراح الإصلاح بانتظار القرار. لم ينفذ بعد.' },
  decide_approve: { en: 'The repair was applied after approval.', ar: 'نفذ الإصلاح بعد الموافقة.' },
  decide_reject: { en: 'The repair was rejected and left unchanged.', ar: 'رفض الإصلاح وبقي بلا تنفيذ.' },
  rerun_tests: { en: 'The affected tests are queued.', ar: 'الاختبارات المتأثرة أصبحت في قائمة الانتظار.' },
  compare_runs: { en: 'Here is the comparison.', ar: 'هذه نتيجة المقارنة.' },
  show_comparison: { en: 'These are the saved comparison totals.', ar: 'هذه أرقام المقارنة المحفوظة.' },
  empty_comparison: { en: 'No saved comparison was found.', ar: 'لا توجد مقارنة محفوظة.' },
  missing: { en: 'There is no approved version to test.', ar: 'لا توجد نسخة معتمدة للاختبار.' },
  none: {
    en: 'I can list runs, list findings, propose a plan, start a run after an exact approval, explain a finding, propose a repair, apply a repair after an exact approval, rerun affected tests, or compare two runs.',
    ar: 'أستطيع عرض التشغيلات، أو عرض النتائج، أو اقتراح خطة، أو بدء تشغيل بعد موافقة صريحة، أو شرح نتيجة، أو اقتراح إصلاح، أو تطبيق إصلاح بعد موافقة صريحة، أو إعادة الاختبارات المتأثرة، أو مقارنة تشغيلين.',
  },
} satisfies Record<string, Bilingual>;

export const failureReply = {
  list_runs: { en: 'The test runs were not shown.', ar: 'لم تعرض تشغيلات الاختبار.' },
  list_findings: { en: 'The findings were not shown.', ar: 'لم تعرض النتائج.' },
  propose_plan: { en: 'No plan was proposed.', ar: 'لم تقترح أي خطة.' },
  none: { en: 'Nothing was changed.', ar: 'لم يتغير شيء.' },
  start_run: { en: 'No test run was queued.', ar: 'لم يوضع تشغيل في قائمة الانتظار.' },
  explain_finding: { en: 'No finding was explained.', ar: 'لم يشرح أي نتيجة.' },
  propose_repair: { en: 'No repair proposal was saved.', ar: 'لم يحفظ اقتراح للإصلاح.' },
  decide_repair: { en: 'The repair decision was not recorded.', ar: 'لم يسجل قرار الإصلاح.' },
  rerun_tests: { en: 'No affected test was queued.', ar: 'لم تعد الاختبارات المتأثرة.' },
  compare_runs: { en: 'The comparison was not saved.', ar: 'لم تحفظ المقارنة.' },
  show_comparison: { en: 'The saved comparison was not shown.', ar: 'لم تعرض المقارنة المحفوظة.' },
  partial_start: { en: 'The plan was approved. No test run was queued.', ar: 'اعتُمدت الخطة. لم يوضع تشغيل في قائمة الانتظار.' },
} satisfies Record<string, Bilingual>;

export const actionErrors = {
  approval_required: { code: 'approval_required', message: 'An exact approval from an allowed role is required.', ar: 'تلزم موافقة صريحة من دور مسموح له.' },
  four_eyes: { code: 'four_eyes', message: 'Another member must decide.', ar: 'يجب أن يقرر عضو آخر.' },
  not_waiting: { code: 'not_waiting', message: 'The plan is not waiting for a decision.', ar: 'الخطة ليست بانتظار قرار.' },
  not_approved: { code: 'not_approved', message: 'An approved plan is required.', ar: 'تلزم خطة معتمدة.' },
  not_found: { code: 'not_found', message: 'The record was not found.', ar: 'لم يعثر على السجل.' },
  not_finished: { code: 'not_finished', message: 'Both runs must be finished.', ar: 'يجب أن يكون التشغيلان منتهيين.' },
  same_run: { code: 'same_run', message: 'Two different runs are needed.', ar: 'يلزم تشغيلان مختلفان.' },
  version: { code: 'version', message: 'The agent version cannot be tested.', ar: 'لا يمكن اختبار نسخة الوكيل هذه.' },
  impersonation: { code: 'impersonation', message: 'You cannot act as another member.', ar: 'لا يمكنك أن تتصرف بصفة عضو آخر.' },
  failed: { code: 'failed', message: 'The action was not completed.', ar: 'لم يتم تنفيذ الإجراء.' },
  repair: { code: 'invalid_patch', message: 'That repair is not allowed.', ar: 'هذا الإصلاح غير مسموح.' },
  budget_too_small: { code: 'budget_too_small', message: 'The budget is too small for a test.', ar: 'الميزانية أصغر من أن تكفي لاختبار.' },
  widens_tools: { code: 'widens_tools', message: 'A plan cannot add tools.', ar: 'لا يمكن للخطة أن تضيف أدوات.' },
  widens_permissions: { code: 'widens_permissions', message: 'A plan cannot add permissions.', ar: 'لا يمكن للخطة أن تضيف صلاحيات.' },
  validation: { code: 'validation', message: 'Check the details and try again.', ar: 'تحقق من التفاصيل ثم أعد المحاولة.' },
} satisfies Record<string, ActionError>;

export const causeCopy: Record<string, Bilingual> = {
  missing_authorization: {
    en: 'The reply used a case the requester does not own. The cause is missing authorization.',
    ar: 'استخدم الرد حالة لا يملكها مقدم الطلب. السبب نقص في التفويض.',
  },
  wrong_tool_argument: {
    en: 'A write tool rejected the arguments. The cause is a wrong tool argument.',
    ar: 'رفضت أداة الكتابة المدخلات. السبب مدخلات أداة غير صحيحة.',
  },
  workflow_failure: {
    en: 'The case or the review landed in the wrong queue while the tools reported success. The cause is the workflow.',
    ar: 'استقرت الحالة أو المراجعة في قائمة غير القائمة المعتمدة بينما أبلغت الأدوات عن النجاح. السبب سير العمل.',
  },
  adapter_failure: {
    en: 'The case was not stored, or the reply claimed success after a failed create. The cause is the adapter.',
    ar: 'لم تحفظ الحالة، أو ادعى الرد النجاح بعد فشل الإنشاء. السبب المهايئ.',
  },
  knowledge_or_source: {
    en: 'The reply review found a wrong or incomplete policy answer. The cause is knowledge or the source.',
    ar: 'وجدت مراجعة الرد إجابة سياسة خاطئة أو ناقصة. السبب المعرفة أو المصدر.',
  },
  prompt_ambiguity: {
    en: 'The reply refused in the wrong place, or it did not refuse when a refusal was required. The cause is the instructions.',
    ar: 'رفض الرد في غير موضعه، أو لم يرفض عندما كان الرفض مطلوبا. السبب التعليمات.',
  },
  unknown: {
    en: 'The cause is not in the known list. A reviewer should investigate before any change.',
    ar: 'السبب ليس في القائمة المعروفة. ينبغي أن يتحقق المراجع قبل أي تغيير.',
  },
};

const claimKinds = ['list_runs', 'list_findings', 'propose_plan', 'start_run', 'explain_finding', 'propose_repair', 'decide_approve', 'decide_reject', 'rerun_tests', 'compare_runs', 'show_comparison'] as const;
const successMarkers = claimKinds.flatMap((kind) => {
  const reply = successReply[kind];
  return [reply.en, reply.ar];
});
export function claimsDone(text: string) {
  return successMarkers.some((marker) => text.includes(marker));
}

function replyLine(table: Record<string, Bilingual>, kind: string): Bilingual | undefined {
  return table[kind];
}

/** A reply may name a success only when this call finished it. */
export function replyFor(kind: string, done: boolean, error?: ActionError, extra?: Bilingual): Bilingual {
  const base = (done ? replyLine(successReply, kind) : replyLine(failureReply, kind)) ?? (done ? successReply.none : failureReply.none);
  const reply = !done && error
    ? { en: `${base.en} ${error.message}`, ar: `${base.ar} ${error.ar}` }
    : extra && done
      ? { en: `${base.en} ${extra.en}`, ar: `${base.ar} ${extra.ar}` }
      : { en: base.en, ar: base.ar };
  if (!done && (claimsDone(reply.en) || claimsDone(reply.ar))) throw new Error('Unconfirmed success claim');
  return reply;
}

export function idsIn(text: string): string[] {
  return [...text.matchAll(new RegExp(uuidPattern.source, 'g'))].map((match) => match[0]!.toLowerCase());
}

const reasonPart = '(.+?)';
const evidenceEn = String.raw`\. I opened the evidence\.$`;
const evidenceAr = String.raw`\. اطلعت على الدليل\.$`;

function exact(pattern: RegExp, message: string) {
  const match = message.trim().match(pattern);
  const reason = match?.[2]?.trim() ?? '';
  const id = match?.[1]?.toLowerCase();
  if (!id || reason.length < 10 || reason.length > 2000) return null;
  return { id, reason, evidence_opened: true as const };
}

export function exactRepair(message: string) {
  const approve = exact(new RegExp(String.raw`^I approve repair (${uuidRe}) because ${reasonPart}${evidenceEn}`, 'i'), message)
    ?? exact(new RegExp(String.raw`^أوافق على الإصلاح (${uuidRe}) لأن ${reasonPart}${evidenceAr}`), message);
  if (approve) return { ...approve, decision: 'approve' as const };
  const reject = exact(new RegExp(String.raw`^I reject repair (${uuidRe}) because ${reasonPart}${evidenceEn}`, 'i'), message)
    ?? exact(new RegExp(String.raw`^أرفض الإصلاح (${uuidRe}) لأن ${reasonPart}${evidenceAr}`), message);
  return reject ? { ...reject, decision: 'reject' as const } : null;
}

export function exactPlan(message: string) {
  return exact(new RegExp(String.raw`^I approve plan (${uuidRe}) and start the run because ${reasonPart}${evidenceEn}`, 'i'), message)
    ?? exact(new RegExp(String.raw`^أوافق على الخطة (${uuidRe}) وأبدأ التشغيل لأن ${reasonPart}${evidenceAr}`), message);
}

export function asksImpersonation(message: string) {
  return /(?:act as|impersonate|اعمل باسم|بصفة العضو)\s+[0-9a-f]{8}-/i.test(message);
}

const identityKeys = ['member_id', 'workspace_id', 'act_as', 'user_id', 'on_behalf_of'];
export function identityOverride(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value as Record<string, unknown>).some((key) => identityKeys.includes(key));
}

export function chatIntent(message: string): AgentToolName {
  if (exactRepair(message)) return 'decide_repair';
  if (exactPlan(message)) return 'start_run';
  if (/rerun the affected|أعد الاختبارات المتأثرة|اعد الاختبارات المتأثرة/i.test(message)) return 'rerun_tests';
  if (/show the comparison|اعرض المقارنة|أظهر المقارنة/i.test(message)) return 'compare_runs';
  if (/compare(?: the)? runs|قارن التشغيل/i.test(message)) return 'compare_runs';
  if (/propose a repair|اقترح إصلاح|اقترح اصلاح/i.test(message)) return 'propose_repair';
  if (/explain the finding|explain findings|اشرح النتيجة|اشرح السبب/i.test(message)) return 'explain_finding';
  if (/start the run|ابدأ التشغيل/i.test(message)) return 'start_run';
  if (/plan and start|اقترح خطة وابدأ|اقترح خطة|propose (?:a )?plan/i.test(message)) return 'propose_plan';
  if (/اعرض النتائج|أظهر النتائج|list findings/i.test(message)) return 'list_findings';
  if (/اعرض التشغيلات|أظهر التشغيلات|list runs/i.test(message)) return 'list_runs';
  return 'none';
}

/** A clear user request wins. Exact approval wins over the model, and a model cannot switch the user to another action. */
export function pickTool(message: string, modelTool: AgentToolName | null): AgentToolName {
  if (exactRepair(message)) return 'decide_repair';
  if (exactPlan(message)) return 'start_run';
  const asked = chatIntent(message);
  if (asked !== 'none') return asked;
  return modelTool ?? 'none';
}

export const repairArgs = z.object({
  id: z.uuid(),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(10).max(2000),
  evidence_opened: z.literal(true),
}).strict();

export const planArgs = z.object({
  plan_id: z.uuid(),
  reason: z.string().trim().min(10).max(2000),
  evidence_opened: z.literal(true),
}).strict();

export function mcpRepair(value: unknown) {
  const parsed = repairArgs.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function mcpPlan(value: unknown) {
  const parsed = planArgs.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function budgetFrom(message: string) {
  const cost = message.match(/(\d{1,6})\s*cost(?:\s*per\s*call\s*(\d{1,6}))?/i);
  if (cost?.[1]) return { kind: 'cost' as const, max: Number(cost[1]), perCall: Number(cost[2] ?? 1) };
  const calls = message.match(/(\d{1,6})\s*(?:calls|مكالمات)/);
  if (calls?.[1]) return { kind: 'calls' as const, max: Number(calls[1]) };
  return { kind: 'calls' as const, max: 8 };
}
