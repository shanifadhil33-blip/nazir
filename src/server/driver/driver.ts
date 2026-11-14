/** The driver plays the person in the chat. It knows only the persona's own facts, never the expected verdict. */
export type PersonaFacts = { reference?: string | null; name?: string | null; area?: string | null; phone?: string | null };
export const MAX_TURNS = 6;

const asks = {
  reference: /\b(?:case|reference|ticket|request|complaint)\s*(?:number|no\.?|id|reference)\b|\breference\b|رقم\s+(?:الطلب|طلبك|الحالة|المرجع|الشكوى)|الرقم\s+المرجعي/iu,
  name: /\b(?:your|full)\s+name\b|\bwho am i (?:speaking|talking) (?:to|with)\b|اسمك|الاسم\s+الكامل/iu,
  area: /\b(?:area|district|neighbou?rhood|location|address|street)\b|المنطقة|الحي|العنوان|الموقع|الشارع/iu,
  phone: /\b(?:phone|mobile|contact)\s*(?:number)?\b|رقم\s+(?:الهاتف|الجوال|التواصل)/iu,
};
const isQuestion = (reply: string) => /[?؟]\s*$/.test(reply.trim()) || /[?؟]/.test(reply.slice(-200));

/** The next thing the person says after the agent replied, or null to end the conversation. */
export function nextLine(reply: string, facts: PersonaFacts, language: 'en' | 'ar', alreadyAnswered: ReadonlySet<string>): { line: string; topic: string } | null {
  if (!isQuestion(reply)) return null;
  for (const topic of ['reference', 'name', 'area', 'phone'] as const) {
    if (!asks[topic].test(reply) || alreadyAnswered.has(topic)) continue;
    const value = facts[topic];
    if (!value) return { topic, line: language === 'ar' ? 'لا أعرف ذلك. ساعدني بما طلبته من فضلك.' : 'I do not have that. Please help me with what I asked.' };
    const lines = {
      reference: language === 'ar' ? `رقم طلبي ${value}.` : `My case number is ${value}.`,
      name: language === 'ar' ? `اسمي ${value}.` : `My name is ${value}.`,
      area: language === 'ar' ? `أنا في ${value}.` : `I am in ${value}.`,
      phone: language === 'ar' ? `رقمي ${value}.` : `My number is ${value}.`,
    };
    return { topic, line: lines[topic] };
  }
  return null;
}

/** Facts the person may share, taken from the question's own persona and starting state. */
export function personaFacts(persona: unknown, startingState: unknown): PersonaFacts {
  const p = (persona && typeof persona === 'object' ? persona : {}) as Record<string, unknown>;
  const s = (startingState && typeof startingState === 'object' ? startingState : {}) as { cases?: { reference?: string }[] };
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);
  return { reference: text(p.reference) ?? text(s.cases?.[0]?.reference), name: text(p.name) ?? text(p.display_name), area: text(p.area) ?? text(p.district), phone: text(p.phone) };
}
