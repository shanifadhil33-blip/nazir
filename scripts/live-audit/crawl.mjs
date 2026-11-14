import { mkdir } from 'node:fs/promises';
import { OUT, profiles, launch, signin, settle, snapshot, save, isMain } from './signin.mjs';

const selector = 'a,button,[role=button],article,[onclick],.nz-pastel';
const screens = { home: '', checks: '?screen=checks', fixes: '?screen=failures', after: '?screen=after', history: '?screen=history', settings: '?screen=settings', report: '/report' };
// Writes are exercised explicitly in persist.mjs. Every excluded control is recorded, never silently passed.
const writes = /start|stop|approve|reject|turn down|suggest|test again|check again|reset|sign out|save|submit|connect|copy|share|ابدأ|بدء|إيقاف|أوقف|موافق|وافق|رفض|اقترح|أعد|إعادة|تسجيل الخروج|احفظ|حفظ|اتصل|نسخ|مشاركة/i;
export function classifyClick(before, after, { actionable = true, disabled = false, externalEffect = false } = {}) {
  if (!actionable) return 'NOT-CLICKABLE';
  if (disabled) return 'DISABLED';
  if (externalEffect || before.url !== after.url || before.heading !== after.heading || before.stateHash !== after.stateHash) return 'CHANGED';
  return 'DEAD-CONTROL';
}
export function duplicateDestinations(rows) {
  const groups = new Map();
  const duplicates = [];
  for (const row of rows) {
    if (row.verdict !== 'CHANGED' || !row.siblingGroup || !row.destination) continue;
    // Different URLs do not excuse two rows showing the same destination content.
    const key = JSON.stringify([row.screen, row.siblingGroup, row.destination.heading, row.destination.textHash]);
    const previous = groups.get(key);
    if (previous) duplicates.push({ verdict: 'SAME-AS-OTHER', first: previous.id, second: row.id, screen: row.screen });
    else groups.set(key, row);
  }
  return duplicates;
}
export function inventoryElements(elements) {
    const visible = (el) => {
      if (!el.getClientRects().length) return false;
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      }
      return true;
    };
    const path = (el) => {
      const parts = [];
      while (el && el !== document.body) {
        parts.unshift(`${el.tagName.toLowerCase()}:nth-child(${[...el.parentElement.children].indexOf(el) + 1})`);
        el = el.parentElement;
      }
      return 'body > ' + parts.join(' > ');
    };
    return elements.filter(visible).map((el) => {
      const action = el.matches('a,button,[role=button],[onclick]') || !!el.querySelector('a,button,[role=button],[onclick]');
      // Inventory the interactive child separately, without double-clicking its wrapping article.
      const wrapper = !el.matches('a,button,[role=button],[onclick]') && action;
      const row = el.closest('li,article,.nz-check-card,.nz-pastel,.nz-history-row');
      return { id: path(el), label: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        href: el.getAttribute('href'), actionable: action, wrapper, disabled: el.matches(':disabled,[aria-disabled=true]'),
        current: el.matches('[aria-current=page],[aria-selected=true]'), siblingGroup: row ? path(row.parentElement) : null };
    });
}
export async function inventory(page) {
  return page.locator(selector).evaluateAll(inventoryElements);
}

/** Same path links (only ?screen= changes) render after the router updates. Compare URLs without the language pin. */
export function samePlace(a, b) {
  const clean = (value) => { const url = new URL(value, 'https://x.invalid'); url.searchParams.delete('lang'); url.searchParams.sort(); return url.pathname + url.search + url.hash; };
  return clean(a) === clean(b);
}
/** Query navigation can leave the pathname unchanged while the next screen renders. */
export async function waitForClick(page, before, navigation = false, timeoutMs = 8000, target = null) {
  if (target && !samePlace(target, before.url)) {
    // Wait for the router to reach the link's own address before reading the screen.
    await page.waitForURL((url) => samePlace(url.pathname + url.search + url.hash, target), { timeout: timeoutMs }).catch(() => {});
  }
  const deadline = Date.now() + timeoutMs;
  let after;
  do {
    after = await snapshot(page);
    if (before.url !== after.url || before.heading !== after.heading || (!navigation && before.stateHash !== after.stateHash)) return after;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  return after;
}
export async function crawl() {
  const browser = await launch();
  const all = [];
  await mkdir(OUT, { recursive: true });
  try {
    for (const profile of profiles) for (const lang of ['en', 'ar']) {
      const s = await signin(browser, profile, lang);
      const rows = [];
      for (const [screen, suffix] of Object.entries(screens)) {
        const url = `${s.base}/w/${s.ws}${suffix}${suffix.includes('?') ? '&' : '?'}lang=${lang}`;
        try {
          await s.page.goto(url); await settle(s.page);
          await s.page.screenshot({ path: `${OUT}/${profile.name}-${lang}-${screen}.png`, fullPage: true });
        } catch {
          rows.push({ screen, verdict: 'SCREEN-FAILED' });
          await s.page.screenshot({ path: `${OUT}/${profile.name}-${lang}-${screen}-failed.png`, fullPage: true }).catch(() => {});
          continue;
        }
        for (const el of await inventory(s.page)) {
          const record = { screen, ...el };
          if (el.wrapper || el.current) record.verdict = el.wrapper ? 'WRAPPER' : 'CURRENT';
          else if (!el.actionable) record.verdict = 'NOT-CLICKABLE';
          else if (el.disabled) record.verdict = 'DISABLED';
          else if (writes.test(el.label) || /start=1|signout|\/connect/.test(el.href || '')) record.verdict = 'SKIPPED-WRITE';
          else if (el.href && new URL(el.href, s.base).origin !== s.base) record.verdict = 'EXTERNAL';
          else {
            try {
              await s.page.goto(url); await settle(s.page);
              const control = s.page.locator(el.id);
              if (!await control.isVisible()) { rows.push({ ...record, verdict: 'HIDDEN' }); continue; }
              const before = await snapshot(s.page);
              // A link to the screen already open is reported on its own, never as a dead control.
              if (el.href && !el.href.startsWith('#') && samePlace(el.href, before.url)) { rows.push({ ...record, verdict: 'SELF-LINK' }); continue; }
              const downloads = []; const popups = [];
              const download = (item) => downloads.push(item); const popup = (item) => popups.push(item);
              s.page.on('download', download); s.page.on('popup', popup);
              try {
                await control.click({ timeout: 5000 });
                await waitForClick(s.page, before, Boolean(el.href), 8000, el.href);
                await settle(s.page);
                record.destination = await snapshot(s.page);
                record.verdict = classifyClick(before, record.destination, { externalEffect: downloads.length > 0 || popups.length > 0 });
              } finally {
                s.page.off('download', download); s.page.off('popup', popup);
                for (const popup of popups) await popup.close();
              }
              if (record.verdict === 'DEAD-CONTROL') await s.page.screenshot({ path: `${OUT}/${profile.name}-${lang}-${screen}-dead-${rows.length}.png` });
            } catch {
              record.verdict = 'CLICK-FAILED';
              await s.page.screenshot({ path: `${OUT}/${profile.name}-${lang}-${screen}-click-failed-${rows.length}.png` }).catch(() => {});
            }
          }
          rows.push(record);
        }
      }
      const duplicates = duplicateDestinations(rows);
      all.push({ profile: profile.name, lang, rows, duplicates });
      await save(`crawl-${profile.name}-${lang}`, { rows, duplicates });
      await s.context.close();
    }
    const failures = all.reduce((n, result) => n + result.duplicates.length + result.rows.filter((row) => ['DEAD-CONTROL', 'NOT-CLICKABLE', 'CLICK-FAILED', 'SCREEN-FAILED'].includes(row.verdict)).length, 0);
    await save('crawl', { failures, results: all });
    if (failures) process.exitCode = 1;
  } finally { await browser.close(); }
}
if (isMain(import.meta.url)) crawl().catch(async () => { await save('crawl-error', { failure: 'Crawl incomplete, inspect sign in and browser setup' }); process.exitCode = 1; });
