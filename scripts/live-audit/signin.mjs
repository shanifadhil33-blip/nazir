import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const OUT = process.env.OUT_DIR || '/workspace/nazir-mobile-fix/live-0';
export const profiles = [
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' },
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
];
export function baseUrl() {
  const url = new URL(process.env.BASE_URL || 'https://nazir-liard.vercel.app');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use a site URL without credentials');
  return url.origin;
}
export const hash = (text) => createHash('sha256').update(text).digest('hex');
export async function save(name, result) {
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/${name}.json`, JSON.stringify(result, null, 2));
}
export async function launch() {
  // Import only when running live. Unit tests and the gate need no browser package or browser binary.
  const { chromium } = await import('playwright');
  return chromium.launch();
}
export async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    return main && !['loading', 'error'].includes(main.getAttribute('data-state'));
  }, undefined, { timeout: 20000 });
  await page.waitForTimeout(700);
}
export async function signin(browser, profile = profiles[0], lang = 'en') {
  const options = { ...profile };
  delete options.name;
  const context = await browser.newContext({ ...options, locale: lang === 'ar' ? 'ar-AE' : 'en-GB' });
  const page = await context.newPage();
  const base = baseUrl();
  await page.goto(`${base}/signin?lang=${lang}#demo`);
  await page.locator('#demo button').filter({ hasText: /Omar|عمر/ }).click();
  await page.waitForURL(/\/w\/[^/?#]+/, { timeout: 45000 });
  const ws = new URL(page.url()).pathname.split('/')[2];
  const response = await page.request.get(`${base}/api/me`);
  if (!response.ok()) throw new Error('Demo sign in failed');
  const me = await response.json();
  const membership = me.memberships?.find((item) => item.workspaceId === ws);
  if (!membership || membership.kind !== 'demo' || !/Omar|عمر/.test(me.user?.name || '')) throw new Error('Expected Omar in the demo');
  await settle(page);
  // Keep sessions in memory only. Never write cookies or session tokens to audit results.
  return { context, page, ws, base };
}
export async function snapshot(page) {
  const result = await page.evaluate(() => {
    const main = document.querySelector('main');
    const text = (main?.innerText || document.body.innerText).replace(/\s+/g, ' ').trim();
    const controls = [...document.querySelectorAll('input,textarea,select')].map((el) => ({ value: el.type === 'password' ? '' : el.value, checked: el.checked }));
    return { url: location.pathname + location.search + location.hash, heading: document.querySelector('h1,h2')?.textContent?.trim() || '', text, controls,
      expanded: [...document.querySelectorAll('[aria-expanded],[role=dialog],[role=menu]')].map((el) => [el.getAttribute('aria-expanded'), el.textContent?.trim()]) };
  });
  return { ...result, textHash: hash(result.text), stateHash: hash(JSON.stringify([result.text, result.controls, result.expanded])) };
}
export const isMain = (url) => process.argv[1] && url === pathToFileURL(process.argv[1]).href;
if (isMain(import.meta.url)) {
  let browser;
  try {
    browser = await launch();
    await mkdir(OUT, { recursive: true });
    const results = [];
    for (const profile of profiles) for (const lang of ['en', 'ar']) {
      const s = await signin(browser, profile, lang);
      await s.page.screenshot({ path: `${OUT}/signin-${profile.name}-${lang}.png`, fullPage: true });
      results.push({ profile: profile.name, lang, signedInAs: 'Omar', workspaceKind: 'demo' });
      await s.context.close();
    }
    await save('signin', results);
  } catch { await save('signin', { failure: 'Sign in or browser unavailable' }); process.exitCode = 1; }
  finally { await browser?.close(); }
}
