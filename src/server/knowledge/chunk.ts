/** Cuts a document into chunks of up to about 800 characters on paragraph, line and sentence ends. Table rows stay whole and keep their header row. */
export function chunkText(body: string, max = 800): string[] {
  const clean = body.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (!clean) return [];
  const blocks = clean.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];
  let current = '';
  const flush = () => { if (current.trim()) out.push(current.trim()); current = ''; };
  const pieces = (block: string): string[] => {
    if (block.length <= max) return [block];
    const lines = block.split('\n');
    const table = lines.length > 2 && lines.filter((l) => /[|,\t]/.test(l)).length >= lines.length - 1;
    if (table) {
      const head = lines[0]!; const parts: string[] = []; let part = head;
      for (const line of lines.slice(1)) { if ((part + '\n' + line).length > max && part !== head) { parts.push(part); part = head; } part += '\n' + line; }
      parts.push(part);
      return parts.map((p) => p.slice(0, max * 2));
    }
    const sentences = block.match(/[^.!?؟\n]+[.!?؟]*\s*/gu) ?? [block];
    const parts: string[] = []; let part = '';
    for (const s of sentences) {
      if ((part + s).length > max && part) { parts.push(part.trim()); part = ''; }
      if (s.length > max) { for (let i = 0; i < s.length; i += max) parts.push(s.slice(i, i + max).trim()); continue; }
      part += s;
    }
    if (part.trim()) parts.push(part.trim());
    return parts;
  };
  for (const block of blocks) for (const piece of pieces(block)) {
    if (current && (current + '\n\n' + piece).length > max) flush();
    current = current ? current + '\n\n' + piece : piece;
  }
  flush();
  return out.filter(Boolean).map((c) => c.slice(0, 2000));
}

const stop = new Set(['the', 'and', 'for', 'are', 'was', 'what', 'how', 'does', 'can', 'you', 'your', 'with', 'this', 'that', 'from', 'have', 'has', 'not', 'any', 'about', 'tell', 'please', 'which', 'when', 'who', 'is', 'it', 'of', 'to', 'in', 'on', 'a', 'an', 'or', 'do', 'me', 'my', 'search', 'knowledge', 'base',
  'ما', 'ماذا', 'هل', 'كيف', 'في', 'من', 'على', 'عن', 'إلى', 'الى', 'هذا', 'هذه', 'التي', 'الذي', 'مع', 'أو', 'او', 'لا', 'كم', 'متى', 'ابحث', 'قاعدة', 'المعرفة']);
/** Plain words to look up: letters and digits only, no stop words, at most 12. Nothing else reaches the query. */
export function searchTerms(question: string): string[] {
  const words = (question.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.replace(/[\u064B-\u0652\u0640]/g, ''));
  return [...new Set(words.filter((w) => w.length >= 2 && w.length <= 40 && !stop.has(w)))].slice(0, 12);
}
