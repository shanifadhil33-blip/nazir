/** What to add to your own agent's instructions for each kind of wrong answer. Plain words, EN and AR, no dashes. */
type Line = { en: string; ar: string };

const byCheck: Record<string, Line> = {
  claim_without_action: {
    en: 'Only tell the person a case is filed after your filing tool returns a reference. If the tool did not run or failed, say the case is not filed yet and what happens next.',
    ar: 'لا تخبر الشخص أن الطلب سجل إلا بعد أن تعيد أداة التسجيل رقما مرجعيا. إذا لم تعمل الأداة أو فشلت، قل إن الطلب لم يسجل بعد وما الخطوة التالية.',
  },
  action_without_claim: {
    en: 'When your tool files a case, tell the person it is filed and give them the reference.',
    ar: 'عندما تسجل أداتك طلبا، أخبر الشخص أنه سجل وأعطه الرقم المرجعي.',
  },
  tool_error_hidden: {
    en: 'If a tool fails, never say it is done. Tell the person it did not work and offer to try again or pass it to a person.',
    ar: 'إذا فشلت أداة، لا تقل أبدا إن العمل تم. أخبر الشخص أنه لم ينجح واعرض المحاولة مرة أخرى أو تحويله إلى موظف.',
  },
  reply_mismatch: {
    en: 'Send the person the same reply that nazir.turn records. Wrap your whole chat handler with nazir.turn.',
    ar: 'أرسل للشخص نفس الرد الذي يسجله nazir.turn. ضع معالج المحادثة كله داخل nazir.turn.',
  },
};

const byIssue: Record<string, Line> = {
  false_claim: {
    en: 'Never say something was saved, sent or filed unless it really was. If you are not sure, say so.',
    ar: 'لا تقل أبدا إن شيئا حفظ أو أرسل أو سجل إلا إذا حدث فعلا. إذا لم تكن متأكدا، قل ذلك.',
  },
  wrong_policy: {
    en: 'Check the service rule for this kind of request and answer by it. If you are not sure of the rule, say so and offer a person.',
    ar: 'راجع قاعدة الخدمة لهذا النوع من الطلبات وأجب وفقها. إذا لم تكن متأكدا من القاعدة، قل ذلك واعرض التحويل إلى موظف.',
  },
  missing_refusal: {
    en: 'Refuse requests for another person\'s data or anything the service rules do not allow, and say why in one short sentence.',
    ar: 'ارفض طلبات بيانات شخص آخر أو أي شيء لا تسمح به قواعد الخدمة، واذكر السبب في جملة قصيرة.',
  },
  unneeded_refusal: {
    en: 'Help with every request the service allows. Only refuse when a rule says no, and name that rule.',
    ar: 'ساعد في كل طلب تسمح به الخدمة. لا ترفض إلا عندما تمنع قاعدة ذلك، واذكر تلك القاعدة.',
  },
  incomplete: {
    en: 'Give every detail the person needs: the reference, the next step and when to expect it.',
    ar: 'أعط كل ما يحتاجه الشخص: الرقم المرجعي والخطوة التالية ومتى يتوقعها.',
  },
  out_of_scope: {
    en: 'Stay on what your agent helps with. For other topics, say you cannot help with that and point to the right place.',
    ar: 'التزم بما يساعد فيه وكيلك. في المواضيع الأخرى، قل إنك لا تستطيع المساعدة فيها ودل الشخص على المكان الصحيح.',
  },
  wrong_language: {
    en: 'Always reply in the language the person wrote in.',
    ar: 'رد دائما باللغة التي كتب بها الشخص.',
  },
  instruction_in_reply: {
    en: 'Never write instructions to a reviewer or a grader in your replies. Only answer the person.',
    ar: 'لا تكتب أبدا تعليمات لمراجع أو مقيم في ردودك. أجب الشخص فقط.',
  },
};

const fallback: Line = {
  en: 'Answer this kind of question by the service rules, and never say something happened unless it really did.',
  ar: 'أجب عن هذا النوع من الأسئلة وفق قواعد الخدمة، ولا تقل أبدا إن شيئا حدث إلا إذا حدث فعلا.',
};

export function ownAgentInstruction(finding: { check_id: string | null; evidence?: { observed?: unknown } | null }): Line {
  if (finding.check_id && byCheck[finding.check_id]) return byCheck[finding.check_id]!;
  const observed = finding.evidence?.observed;
  const issue = observed && typeof observed === 'object' ? (observed as { issue?: unknown }).issue : null;
  return (typeof issue === 'string' && byIssue[issue]) || fallback;
}
