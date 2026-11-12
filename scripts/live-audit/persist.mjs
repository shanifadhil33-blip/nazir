import { mkdir } from 'node:fs/promises';
import { OUT, profiles, launch, signin, settle, snapshot, save, isMain } from './signin.mjs';

export function comparePersistence(immediate, reloaded, fresh) {
  return { matches: JSON.stringify(immediate) === JSON.stringify(reloaded) && JSON.stringify(immediate) === JSON.stringify(fresh), immediate, reloaded, fresh };
}
async function truth(page, base, ws) {
  const get = async (path) => {
    const response = await page.request.get(`${base}/api/workspaces/${ws}/${path}`);
    if (!response.ok()) throw new Error('Could not read demo state');
    return response.json();
  };
  const [reports, fixes] = await Promise.all([get('reports'), get('proposals')]);
  // Compare the data that Checks and Fixes render, never auth/session payloads.
  return { reports: reports.reports.map((row) => ({ id: row.id, body: row.body })), fixes: fixes.proposals };
}
export async function persist() {
  const browser = await launch();
  await mkdir(OUT, { recursive: true });
  const results = [];
  try {
    for (const profile of profiles) for (const lang of ['en', 'ar']) {
      const s = await signin(browser, profile, lang);
      const url = `${s.base}/w/${s.ws}?screen=checks&lang=${lang}`;
      // Chunk 0's write: explicit reset, then one immediate seed. Later chunks add their writes here.
      const before = await truth(s.page, s.base, s.ws);
      const oldSamples = new Set(before.reports.filter((row) => row.body.sample === true).map((row) => row.id));
      await s.page.goto(`${s.base}/w/${s.ws}?screen=settings&lang=${lang}`); await settle(s.page);
      const resetCard = s.page.locator('[data-card=reset]');
      await resetCard.locator('button').click();
      const responsePromise = s.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/workspaces/${s.ws}/demo-reset`);
      await resetCard.locator('button[data-variant=ink]').click();
      const response = await responsePromise;
      if (!response.ok()) throw new Error('Demo reset failed');
      await s.page.locator('[data-card=reset][data-reset=done]').waitFor();
      await s.page.screenshot({ path: `${OUT}/persist-${profile.name}-${lang}-reset-done.png`, fullPage: true });
      await s.page.goto(url); await settle(s.page);
      const immediate = await truth(s.page, s.base, s.ws);
      const view = await snapshot(s.page);
      await s.page.screenshot({ path: `${OUT}/persist-${profile.name}-${lang}-immediate.png`, fullPage: true });
      await s.page.reload(); await settle(s.page);
      const reloaded = await truth(s.page, s.base, s.ws);
      const reloadView = await snapshot(s.page);
      await s.page.screenshot({ path: `${OUT}/persist-${profile.name}-${lang}-reload.png`, fullPage: true });
      // A separate context signs in afresh as Omar. No storage state is copied.
      const second = await signin(browser, profile, lang);
      if (second.ws !== s.ws) throw new Error('Expected the same demo workspace');
      await second.page.goto(url); await settle(second.page);
      const fresh = await truth(second.page, second.base, second.ws);
      const freshView = await snapshot(second.page);
      await second.page.screenshot({ path: `${OUT}/persist-${profile.name}-${lang}-fresh.png`, fullPage: true });
      const comparison = comparePersistence(immediate, reloaded, fresh);
      const samples = immediate.reports.filter((row) => row.body.sample === true);
      const sampleCount = samples.length;
      const replaced = samples.every((row) => !oldSamples.has(row.id));
      results.push({ profile: profile.name, lang, write: 'demo-reset', ...comparison, sampleCount, replaced,
        screenMatches: view.textHash === reloadView.textHash && view.textHash === freshView.textHash });
      await second.context.close(); await s.context.close();
    }
    await save('persist', results);
    if (results.some((row) => !row.matches || !row.screenMatches || !row.replaced || row.sampleCount !== 2)) process.exitCode = 1;
  } finally { await browser.close(); }
}
if (isMain(import.meta.url)) persist().catch(async () => { await save('persist-error', { failure: 'Persistence audit incomplete, inspect sign in and browser setup' }); process.exitCode = 1; });
