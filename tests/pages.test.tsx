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
  expect(html).toContain('adhil+bilal@mail.grokbot.com');
  expect(html).toContain('Last updated 19 October 2026.');
});
