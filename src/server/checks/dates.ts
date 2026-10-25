import { eastern } from './shop-checks';

const months: Record<string, string> = {
  'يناير': '01', 'فبراير': '02', 'مارس': '03', 'أبريل': '04', 'ابريل': '04',
  'مايو': '05', 'يونيو': '06', 'يوليو': '07', 'أغسطس': '08', 'اغسطس': '08',
  'سبتمبر': '09', 'أكتوبر': '10', 'اكتوبر': '10', 'نوفمبر': '11', 'ديسمبر': '12',
};
export function replyDates(reply: string): string[] {
  const text = eastern(reply);
  const dates: string[] = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  for (const match of text.matchAll(/\b(\d{1,2})\s+([\u0600-\u06ff]+)\s+(\d{4})\b/gu)) {
    const month = months[match[2]!];
    if (month) dates.push(`${match[3]}-${month}-${match[1]!.padStart(2, '0')}`);
  }
  return [...new Set(dates)];
}
