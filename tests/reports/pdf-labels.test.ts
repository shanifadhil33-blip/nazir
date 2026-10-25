import { expect, it } from 'vitest';
import { reportRunDate, reportTestTitle } from '../../src/server/reports/build';

it.each(['en', 'ar'] as const)('chooses the saved human readable %s title before the stable key', (lang) => {
  const title = { en: 'Permit fee', ar: 'رسوم التصريح' };
  const goal = { en: 'Explain the permit fee', ar: 'شرح رسوم التصريح' };
  expect(reportTestTitle('stable_key', { title, assessment: { goal } }, {}, lang)).toBe(title[lang]);
  expect(reportTestTitle('stable_key', {}, { name: title }, lang)).toBe(title[lang]);
  expect(reportTestTitle('stable_key', { assessment: { goal } }, {}, lang)).toBe(goal[lang]);
  expect(reportTestTitle('stable_key', { title: { [lang]: '  ' } }, {}, lang)).toBe('stable_key');
  expect(reportTestTitle('stable_key', null, null, lang)).toBe('stable_key');
  const other = lang === 'ar' ? 'en' : 'ar';
  expect(reportTestTitle('stable_key', { title: { [other]: title[other] } }, {}, lang)).toBe('stable_key');
});

it.each(['en', 'ar'] as const)('formats the run date in Dubai with the %s zone label', (lang) => {
  const formatted = reportRunDate('2026-10-24T22:05:00Z', lang);
  expect(formatted).toContain('25');
  expect(formatted).toContain('02:05');
  expect(formatted.endsWith(lang === 'ar' ? 'بتوقيت دبي' : 'Dubai time')).toBe(true);
});
