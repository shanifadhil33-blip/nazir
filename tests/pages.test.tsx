import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import HomePage from '../src/app/page';
import PrivacyPage from '../src/app/privacy/page';
import TermsPage from '../src/app/terms/page';

it('Shows both fictional service banners on the home page', () => {
  const html = renderToStaticMarkup(<HomePage />);
  expect(html).toContain('Fictional service and synthetic cases. No live government connection.');
  expect(html).toContain('خدمة افتراضية وحالات اختبار مصطنعة. لا يوجد اتصال مباشر بنظام حكومي.');
});
it('Marks Arabic name and banner with their language and direction', () => {
  const html = renderToStaticMarkup(<HomePage />);
  expect(html).toContain('<p lang="ar" dir="rtl">ناظر</p>');
  expect(html).toContain('<p lang="ar" dir="rtl">خدمة افتراضية وحالات اختبار مصطنعة. لا يوجد اتصال مباشر بنظام حكومي.</p>');
});
it.each([
  ['Privacy', PrivacyPage], ['Terms', TermsPage],
] as const)('Shows the %s heading and contact address', (title, Page) => {
  const html = renderToStaticMarkup(<Page />);
  expect(html).toContain(`<h1>${title}</h1>`);
  expect(html).toContain('shanifadhil022@gmail.com');
  expect(html).toContain('Last updated 19 October 2026.');
});

it.each([PrivacyPage, TermsPage])('provides English and Arabic sections with the contact address', (Page) => {
  const html = renderToStaticMarkup(<Page />);
  expect(html).toContain('<section lang="en">');
  expect(html).toContain('<section lang="ar" dir="rtl">');
  expect(html).toContain('mailto:shanifadhil022@gmail.com');
  expect(html).toContain('آخر تحديث 19 أكتوبر 2026.');
});
it('states the current Google, session and test data storage clearly', () => {
  const html = renderToStaticMarkup(<PrivacyPage />);
  for (const text of ['Google account id', 'expire after 30 days', 'workspaces, roles, test runs, conversations, findings and audit events', 'Vercel', 'Neon', 'Do not enter real personal data', 'third party AI providers']) expect(html).toContain(text);
});
it('states the demonstration limits and acceptable use', () => {
  const html = renderToStaticMarkup(<TermsPage />);
  for (const text of ['prototype for demonstration', 'within the tested scope', 'not a certificate', 'Do not attack the service']) expect(html).toContain(text);
});
