/** Turns stored record lines into sentences. Raw codes stay available for the expand. */

const lexicon: readonly [string, string][] = [
  ['Saeed', 'سعيد'],
  ['Imran', 'عمران'],
  ['complaint review', 'مراجعة الشكاوى'],
  ['general information', 'المعلومات العامة'],
  ['suggestions', 'الاقتراحات'],
  ['open', 'مفتوحة'],
  ['in review', 'قيد المراجعة'],
  ['waiting for review', 'بانتظار المراجعة'],
  ['succeeded', 'نجحت'],
  ['failed', 'فشلت'],
  ['the tool did not finish', 'لم تكمل الأداة العمل'],
  ['the tool input was rejected', 'رفضت مدخلات الأداة'],
  ['record not found', 'لم يعثر على السجل'],
  ['earlier request not found', 'لم يعثر على الطلب السابق'],
  ['none', 'لا توجد'],
];

const tools: Record<string, { en: string; ar: string }> = {
  create_case: { en: 'the case tool', ar: 'أداة الحالة' },
  request_human_review: { en: 'the review tool', ar: 'أداة المراجعة' },
  get_case_status: { en: 'the status tool', ar: 'أداة الاستعلام' },
};

type CaseFact = { ref: string; requester: string; queue: string; status: string; review: string[] };
type ReceiptFact = { tool: string; head: string; extra: string[] };
type Facts = { cases: CaseFact[]; receipts: ReceiptFact[]; noCase: boolean; noTool: boolean };

export type PlainRecord = {
  en: string;
  ar: string;
  rawEn: string | null;
  rawAr: string | null;
};

export type Spoken = { en: string; ar: string; raw: string | null };

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function isTechnical(text: string) {
  return uuid.test(text)
    || /\b[A-Z]{2,}(?:-[A-Z0-9]+){2,}\b/.test(text)
    || /\b[a-z]+_[a-z0-9_]+\b/.test(text)
    || /\([A-Za-z0-9_]+\)/.test(text)
    || /(?:Receipt|الإيصال)\s+\S+:/.test(text);
}

function human(chunk: string) {
  return chunk.replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

function toLang(label: string, lang: 'en' | 'ar') {
  const clean = human(label);
  const row = lexicon.find(([en, ar]) => en.toLowerCase() === clean.toLowerCase() || ar === clean);
  if (row) return lang === 'ar' ? row[1] : row[0];
  if (!clean || /_/.test(clean) || /^[a-z0-9_]+$/.test(clean)) return null;
  return clean;
}

function reviewParts(value: string) {
  const clean = human(value);
  if (!clean || clean.toLowerCase() === 'none' || clean === 'لا توجد') return [];
  return clean.split(/،|,/).map((part) => human(part)).filter((part) => part && part.toLowerCase() !== 'none' && part !== 'لا توجد');
}

function takeSentence(sentence: string, facts: Facts) {
  const enCase = sentence.match(/^Case (.+?), requester (.+?), queue (.+?), status (.+?), review (.+)$/);
  if (enCase) {
    facts.cases.push({ ref: human(enCase[1]!), requester: human(enCase[2]!), queue: human(enCase[3]!), status: human(enCase[4]!), review: reviewParts(enCase[5]!) });
    return true;
  }
  const arCase = sentence.match(/^الحالة (.+)، مقدم الطلب (.+)، القائمة (.+)، الحالة (.+)، المراجعة (.+)$/);
  if (arCase) {
    facts.cases.push({ ref: human(arCase[1]!), requester: human(arCase[2]!), queue: human(arCase[3]!), status: human(arCase[4]!), review: reviewParts(arCase[5]!) });
    return true;
  }
  const enReceipt = sentence.match(/^Receipt \S+: ([^,]+), (.+)$/);
  if (enReceipt) {
    const [head, ...extra] = human(enReceipt[2]!).split(',').map((part) => part.trim()).filter(Boolean);
    facts.receipts.push({ tool: enReceipt[1]!.trim(), head: head ?? '', extra });
    return true;
  }
  const arReceipt = sentence.match(/^الإيصال \S+: ([^،]+)، (.+)$/);
  if (arReceipt) {
    const [head, ...extra] = human(arReceipt[2]!).split('،').map((part) => part.trim()).filter(Boolean);
    facts.receipts.push({ tool: arReceipt[1]!.trim(), head: head ?? '', extra });
    return true;
  }
  if (sentence === 'No case recorded' || sentence === 'لم تسجل أي حالة') { facts.noCase = true; return true; }
  if (sentence === 'No tool was called' || sentence === 'لم تستدع أي أداة') { facts.noTool = true; return true; }
  return false;
}

function parseFacts(text: string): Facts | null {
  const facts: Facts = { cases: [], receipts: [], noCase: false, noTool: false };
  const parts = text.split(/(?<=\.)\s+/).map((part) => part.trim().replace(/\.$/, '')).filter(Boolean);
  if (!parts.length || parts.some((part) => !takeSentence(part, facts))) return null;
  if (!facts.cases.length && !facts.receipts.length && !facts.noCase && !facts.noTool) return null;
  return facts;
}

function renderCase(item: CaseFact, lang: 'en' | 'ar') {
  const hiddenRef = uuid.test(item.ref) || item.ref.length > 48;
  const who = toLang(item.requester, lang) ?? (lang === 'ar' ? 'مقدم الطلب' : 'the requester');
  const queue = toLang(item.queue, lang) ?? (lang === 'ar' ? 'مسجلة' : 'listed');
  const status = toLang(item.status, lang) ?? (lang === 'ar' ? 'في حالة غير مسماة' : 'an unlisted status');
  const review = item.review.map((part) => toLang(part, lang) ?? (lang === 'ar' ? 'مراجعة مسجلة' : 'a recorded review'));
  if (lang === 'ar') {
    const name = hiddenRef ? 'حالة مسجلة' : `الحالة ${item.ref}`;
    const reviewLine = review.length ? `تشمل المراجعة ${review.join(' و')}` : 'لا توجد مراجعة';
    return `${name} تخص ${who}، وهي ${status} في قائمة ${queue}، و${reviewLine}.`;
  }
  const name = hiddenRef ? 'A recorded case' : `Case ${item.ref}`;
  const reviewLine = review.length ? `and the review is ${review.join(', ')}` : 'and no review is recorded';
  return `${name} for ${who} is ${status} in the ${queue} queue, ${reviewLine}.`;
}

function renderReceipt(item: ReceiptFact, lang: 'en' | 'ar') {
  const known = tools[item.tool];
  const tool = known?.[lang] ?? (lang === 'ar' ? 'أداة' : 'a tool');
  const head = item.head ? (toLang(item.head, lang) ?? (lang === 'ar' ? 'انتهت' : 'finished')) : (lang === 'ar' ? 'استُدعيت' : 'was called');
  const extra = item.extra.map((part) => toLang(part, lang) ?? (lang === 'ar' ? 'سبب مسجل' : 'a recorded reason'));
  if (lang === 'ar') {
    const lead = `${head} ${tool}`;
    return extra.length ? `${lead}. ${extra.join('. ')}.` : `${lead}.`;
  }
  const name = tool.charAt(0).toUpperCase() + tool.slice(1);
  if (!item.head) return `${name} was called.`;
  return extra.length ? `${name} ${head} because ${extra.join(', ')}.` : `${name} ${head}.`;
}

function renderFacts(facts: Facts, lang: 'en' | 'ar') {
  const lines = [
    ...facts.cases.map((item) => renderCase(item, lang)),
    ...(!facts.cases.length && facts.noCase ? [lang === 'ar' ? 'لم تسجل أي حالة.' : 'No case was recorded.'] : []),
    ...facts.receipts.map((item) => renderReceipt(item, lang)),
    ...(!facts.receipts.length && facts.noTool ? [lang === 'ar' ? 'لم تستدع أي أداة.' : 'No tool was called.'] : []),
  ];
  return lines.join(' ');
}

const fallback = {
  en: 'A record was saved. Open record detail for the exact lines.',
  ar: 'حُفظ سجل. افتح تفاصيل السجل للسطور الدقيقة.',
};

export function presentRecord(enText: string, arText: string | null | undefined): PlainRecord {
  const en = enText.trim();
  const ar = (arText ?? '').trim();
  const enRaw = isTechnical(en);
  const arRaw = Boolean(ar) && isTechnical(ar);
  if (!enRaw && !arRaw) return { en, ar: ar || en, rawEn: null, rawAr: null };
  const facts = parseFacts(en) ?? (ar ? parseFacts(ar) : null);
  if (!facts) {
    return {
      en: enRaw ? fallback.en : en,
      ar: arRaw ? fallback.ar : (ar || fallback.ar),
      rawEn: enRaw ? en : null,
      rawAr: arRaw ? ar : null,
    };
  }
  return { en: renderFacts(facts, 'en'), ar: renderFacts(facts, 'ar'), rawEn: enRaw ? en : null, rawAr: arRaw ? ar : null };
}

export function presentQuote(text: string | null | undefined, empty: { en: string; ar: string }): Spoken {
  const raw = (text ?? '').trim();
  if (!raw) return { en: empty.en, ar: empty.ar, raw: null };
  if (!isTechnical(raw)) return { en: raw, ar: raw, raw: null };
  const record = presentRecord(raw, null);
  if (record.rawEn && record.en !== fallback.en) return { en: record.en, ar: record.ar, raw };
  return { en: 'The saved reply is a system code.', ar: 'الرد المحفوظ رمز من النظام.', raw };
}
