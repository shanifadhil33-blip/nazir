import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShellLoading } from '../../src/components/shell/loading';
import { loadingShape } from '../../src/components/shell/loading-shape';
import { BackLink } from '../../src/components/shell/back-link';
import { demoWorkspaceId } from '../../src/shared/demo';

it.each(['en', 'ar'] as const)('uses the target URL for %s report geometry without inventing identity', (lang) => {
  const shape = loadingShape(`/w/${demoWorkspaceId}/report/safety/result`, new URLSearchParams({ lang }));
  expect(shape).toEqual({ lang, demo: true, screen: 'report', kind: 'safetyReport', back: true, checks: false, detail: false });
  const html = renderToStaticMarkup(<ShellLoading {...shape} />);
  expect(html).toContain(`dir="${lang === 'ar' ? 'rtl' : 'ltr'}"`);
  expect(html).toContain('nz-loading-demo');
  expect(html).toContain('nz-loading-back');
  expect(html).toContain('nz-float-bar');
  expect(html).toContain('nz-side-nav');
  expect(html).not.toMatch(/Omar|City Help Desk|<a |<button|data-seat/);
});

it('does not infer a sample or a narrow frame for an unknown real home', () => {
  expect(loadingShape('/w/other', new URLSearchParams())).toEqual({ lang: undefined, demo: false, screen: undefined, kind: 'home', back: false, checks: false, detail: false });
  const html = renderToStaticMarkup(<ShellLoading />);
  expect(html).not.toContain('nz-loading-demo');
  expect(html).not.toContain('nz-loading-back');
  expect(html).toContain('Loading');
  expect(html).toContain('جار التحميل');
});

it('reserves a list silhouette for Checks and ignores arbitrary screen names', () => {
  expect(loadingShape('/w/other', new URLSearchParams('screen=checks&tab=safety&lang=ar')).checks).toBe(true);
  expect(loadingShape('/w/other', new URLSearchParams('screen=untrusted&lang=xx')).screen).toBeUndefined();
  expect(loadingShape('/w/other', new URLSearchParams('screen=untrusted&lang=xx')).lang).toBeUndefined();
});

it.each(['en', 'ar'] as const)('pins %s on parent links even when the base or saved preference has another language', (lang) => {
  const html = renderToStaticMarkup(<BackLink href="/w/owned?lang=other&screen=checks#item" label="Home" lang={lang} />);
  expect(html).toContain(`href="/w/owned?lang=${lang}&amp;screen=checks#item"`);
  expect(renderToStaticMarkup(<BackLink href="/w/owned" label="Home" lang={lang} />)).toContain(`href="/w/owned?lang=${lang}"`);
});
