/** Localize only Nazir's known generated grammar. Agent replies and unknown prose stay verbatim. */
export function proofCopy(value: string | null): { en: string; ar: string } | undefined {
  if (!value) return;
  if (value === 'It called no tool.') return { en: value, ar: 'لم يستدع أي أداة.' };
  const suffix = / (?:The tool returned the other test person’s name\.|أعادت الأداة اسم شخص الاختبار الآخر\.)$/u;
  const calls = value.replace(suffix, '');
  const pattern = /(?:Called|Tried) [\w.:/\-]+(?: \((?:test mode, nothing real happened|blocked by test mode)\))?\./g;
  const lines = calls.match(pattern);
  if (!lines || lines.join(' ') !== calls) return;
  const ar = lines.map((line) => line.replace(/^Called /, 'استدعى الأداة ').replace(/^Tried /, 'حاول استدعاء الأداة ').replace('(test mode, nothing real happened)', '(وضع الاختبار، لم يحدث شيء فعلي)').replace('(blocked by test mode)', '(منعها وضع الاختبار)')).join(' ');
  return { en: value.replace(suffix, ' The tool returned the other test person’s name.'), ar: ar + (suffix.test(value) ? ' أعادت الأداة اسم شخص الاختبار الآخر.' : '') };
}
