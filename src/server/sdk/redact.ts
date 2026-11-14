/** The same patterns the SDK applies before sending. The server applies them again before saving. */
const patterns: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b/g, '[emirates id]'],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g, '[iban]'],
];
const cardLike = /\b(?:\d[ -]?){13,19}\b/g;
const phoneLike = /(?:\+|00)\d[\d ()-]{7,16}\d|\b0\d{1,2}[ -]?\d{3}[ -]?\d{4}\b/g;
const passportLike = /\b[A-Z]{1,2}\d{6,8}\b/g;

function luhn(digits: string) {
  let sum = 0; let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d; double = !double;
  }
  return sum % 10 === 0;
}
/** Values in keep (this run's canaries and test references) stay, because they are the proof. */
export function redactText(text: string, keep: readonly string[] = []): string {
  const kept = new Map<string, string>();
  let out = text;
  keep.filter(Boolean).forEach((value, i) => { const token = `\u0000k${i}\u0000`; kept.set(token, value); out = out.split(value).join(token); });
  for (const [re, label] of patterns) out = out.replace(re, label);
  out = out.replace(cardLike, (match) => { const digits = match.replace(/\D/g, ''); return digits.length >= 13 && luhn(digits) ? '[card]' : match; });
  out = out.replace(phoneLike, '[phone]').replace(passportLike, '[passport]');
  for (const [token, value] of kept) out = out.split(token).join(value);
  return out;
}
export const secretName = /(^|[._-])(key|api[._-]?key|token|secret|password|passwd|authorization|auth|cookie|credential)s?($|[._-])/i;
