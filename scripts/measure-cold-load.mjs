// Usage: NAZIR_PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/measure-cold-load.mjs [base] [output]
// Cold means a fresh browser context (empty HTTP cache), not a forced server cold start.
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.NAZIR_PLAYWRIGHT || 'playwright');
const base = process.argv[2] || 'https://nazir-liard.vercel.app';
const output = process.argv[3] || '/workspace/nazir-design/cold-load-before.json';
const workspace = 'd0000000-0000-4000-8000-000000000100';
const browser = await chromium.launch();
const login = await browser.newContext();
const page = await login.newPage();
await page.goto(`${base}/signin?lang=en#demo`);
await page.locator('.nz-demo-btn', { hasText: 'Omar' }).click();
await page.waitForURL(`**/w/${workspace}**`);
await page.waitForFunction(() => document.querySelector('main') && !/Loading|جار/.test(document.querySelector('main').innerText));
const state = await login.storageState(); // Kept in memory; never write session credentials.
const samples = [];
for (const screen of ['home', 'checks', 'failures', 'settings']) {
  const context = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 } });
  const p = await context.newPage();
  for (const cache of ['cold', 'warm']) {
    const started = performance.now();
    const errors = [];
    const onError = (error) => errors.push(error.message);
    p.on('pageerror', onError);
    await p.goto(`${base}/w/${workspace}?lang=en${screen === 'home' ? '' : `&screen=${screen}`}`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => {
      const main = document.querySelector('main');
      return main && main.innerText.trim() && !/Loading|جار/.test(main.innerText);
    }, { timeout: 30000 });
    const readyMs = Math.round(performance.now() - started);
    await p.waitForLoadState('networkidle');
    const timing = await p.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return { documentTtfbMs: Math.round(n.responseStart - n.requestStart), api: performance.getEntriesByType('resource').filter(r => new URL(r.name).pathname.startsWith('/api/')).map(r => ({ path: new URL(r.name).pathname, startMs: Math.round(r.startTime), durationMs: Math.round(r.duration), ttfbMs: Math.round(r.responseStart - r.requestStart) })), text: document.querySelector('main').innerText.slice(0, 120) };
    });
    p.off('pageerror', onError);
    samples.push({ screen, cache, readyMs, ...timing, errors });
    console.log(screen, cache, readyMs, JSON.stringify(timing.api));
  }
  await context.close();
}
const health = [];
for (let i = 0; i < 4; i++) {
  const start = performance.now();
  const response = await fetch(`${base}/api/health`);
  const ttfbMs = Math.round(performance.now() - start);
  await response.arrayBuffer();
  health.push({ status: response.status, ttfbMs, durationMs: Math.round(performance.now() - start), vercelId: response.headers.get('x-vercel-id') });
}
await writeFile(output, JSON.stringify({ base, measuredAt: new Date().toISOString(), method: 'Omar demo form; full URL goto; fresh context per screen, then repeat with warm browser cache; no forced function/DB cold start', samples, health }, null, 2) + '\n');
await browser.close();
