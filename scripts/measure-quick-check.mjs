#!/usr/bin/env node
// Measures one Quick check against a running Nazir: how many step requests it took and how much server time they used.
// Server time is read from each step response's Server-Timing header (step;dur=ms); the browser side wall time is shown too.
// This drives a real run on the target, so it uses that deployment's model calls and daily caps. Not used by tests.
//
//   NAZIR_BASE_URL=https://nazir.example.app NAZIR_COOKIE='authjs.session-token=...' NAZIR_WORKSPACE_ID=<uuid> \
//     node scripts/measure-quick-check.mjs
//
// Optional: NAZIR_RUN_ID=<uuid> measures stepping an already started run instead of asking chat for a Quick check.
// The pacing matches the browser loop (src/components/ocean/step-loop.ts): 1.5 s after progress, backoff to 15 s otherwise.

const base = (process.env.NAZIR_BASE_URL ?? '').replace(/\/+$/, '');
const cookie = process.env.NAZIR_COOKIE ?? '';
const workspace = process.env.NAZIR_WORKSPACE_ID ?? '';
if (!base || !cookie || !/^[0-9a-f-]{36}$/i.test(workspace)) {
  console.error('Set NAZIR_BASE_URL, NAZIR_COOKIE (the session cookie, name=value) and NAZIR_WORKSPACE_ID.');
  process.exit(2);
}
const headers = { cookie, 'accept-language': 'en', 'content-type': 'application/json' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const delay = (misses) => misses <= 0 ? 1500 : Math.min(15000, Math.max(1500, Math.round(Math.min(15000, 1500 * 2 ** misses) * (0.5 + 0.5 * Math.random()))));
/** Sum of every dur= in Server-Timing, or null when the header is missing. */
function serverMs(header) {
  if (!header) return null;
  const durs = [...header.matchAll(/dur=([0-9.]+)/g)].map((m) => Number(m[1]));
  return durs.length ? durs.reduce((a, b) => a + b, 0) : null;
}

async function startQuickCheck() {
  const response = await fetch(`${base}/api/workspaces/${workspace}/agent/chat`, { method: 'POST', headers, body: JSON.stringify({ message: 'run a quick check' }) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Chat refused the Quick check: ${response.status} ${JSON.stringify(body?.error ?? body)}`);
  const ids = new Set();
  const walk = (value, key = '') => {
    if (typeof value === 'string' && key === 'run_id' && /^[0-9a-f-]{36}$/i.test(value)) ids.add(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, key === 'runs' ? 'run' : key));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k === 'id' && key === 'run' ? 'run_id' : k);
  };
  walk(body?.data);
  if (!ids.size) throw new Error(`Chat did not start a run (tool ${body?.tool ?? 'none'}): ${body?.reply?.en ?? ''}`);
  return [...ids];
}

const runIds = process.env.NAZIR_RUN_ID ? [process.env.NAZIR_RUN_ID] : await startQuickCheck();
const totals = { requests: 0, serverMs: 0, missingTiming: 0, wallMs: 0, errors: 0 };
const started = Date.now();
for (const runId of runIds.slice(0, 4)) {
  let misses = 0, last = -1, final = null;
  for (let n = 0; n < 400; n++) {
    const t0 = performance.now();
    const response = await fetch(`${base}/api/workspaces/${workspace}/runs/${runId}/step`, { method: 'POST', headers }).catch(() => null);
    const wall = performance.now() - t0;
    totals.requests++; totals.wallMs += wall;
    const server = serverMs(response?.headers.get('server-timing'));
    if (server === null) totals.missingTiming++; else totals.serverMs += server;
    const p = response?.ok ? await response.json().catch(() => null) : null;
    if (response && !response.ok) await response.text().catch(() => '');
    if (!p) {
      totals.errors++; misses++;
      if (response && response.status < 500) { console.error(`Step refused: ${response.status}`); break; }
      if (totals.errors > 3) break;
    } else {
      const finished = p.passed + p.failed + p.inconclusive;
      console.log(`run ${runId.slice(0, 8)} step ${n + 1}: ${finished}/${finished + p.waiting} done, server ${server ?? '?'} ms, wall ${Math.round(wall)} ms`);
      if (p.done || p.waiting === 0) { final = p; break; }
      if (finished === last) misses++; else { misses = 0; last = finished; }
    }
    await sleep(delay(misses));
  }
  console.log(`run ${runId}: ${final ? `${final.status}, passed ${final.passed}, failed ${final.failed}, inconclusive ${final.inconclusive}` : 'not finished'}`);
}
console.log(JSON.stringify({ runs: runIds.length, step_requests: totals.requests, server_ms: Math.round(totals.serverMs), avg_server_ms: totals.requests ? Math.round(totals.serverMs / Math.max(1, totals.requests - totals.missingTiming)) : 0, wall_ms_in_requests: Math.round(totals.wallMs), elapsed_ms: Date.now() - started, missing_server_timing: totals.missingTiming, errors: totals.errors }, null, 2));
