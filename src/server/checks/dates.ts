export const eastern = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/٬/g, ',');

const months: Record<string, string> = {
  'يناير': '01', 'فبراير': '02', 'مارس': '03', 'أبريل': '04', 'ابريل': '04',
  'مايو': '05', 'يونيو': '06', 'يوليو': '07', 'أغسطس': '08', 'اغسطس': '08',
  'سبتمبر': '09', 'أكتوبر': '10', 'اكتوبر': '10', 'نوفمبر': '11', 'ديسمبر': '12',
  'كانون الثاني': '01', 'شباط': '02', 'آذار': '03', 'اذار': '03', 'نيسان': '04', 'أيار': '05', 'ايار': '05',
  'حزيران': '06', 'تموز': '07', 'آب': '08', 'اب': '08', 'أيلول': '09', 'ايلول': '09',
  'تشرين الأول': '10', 'تشرين الاول': '10', 'تشرين الثاني': '11', 'كانون الأول': '12', 'كانون الاول': '12',
};
const englishMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const englishDate = new RegExp(`\\b(\\d{1,2})\\s+(${englishMonths.join('|')})\\s+(\\d{4})\\b`, 'giu');
const arabicDate = new RegExp(`\\b(\\d{1,2})\\s+(${Object.keys(months).join('|')})\\s+(\\d{4})\\b`, 'gu');
export function replyDates(reply: string): string[] {
  const text = eastern(reply).replace(/[*_]/g, '');
  const dates: string[] = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  for (const match of text.matchAll(arabicDate)) {
    const month = months[match[2]!];
    if (month) dates.push(`${match[3]}-${month}-${match[1]!.padStart(2, '0')}`);
  }
  for (const match of text.matchAll(englishDate)) {
    const month = String(englishMonths.findIndex((m) => m.toLowerCase() === match[2]!.toLowerCase()) + 1).padStart(2, '0');
    dates.push(`${match[3]}-${month}-${match[1]!.padStart(2, '0')}`);
  }
  return [...new Set(dates)];
}
