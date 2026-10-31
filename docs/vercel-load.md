# Vercel load (Hobby)

On Oct 27 Nazir hit the Hobby CPU limit. The cause was 120 s step routes called back to back by the browser. What changed in code:

- **Paced browser loop** (`src/components/ocean/step-loop.ts`). Runs (`workspace-app.tsx`) and the live test (`live-test.tsx`) go through one loop. It waits 1.5 s after a step that made progress. When a step made no progress or failed, it backs off exponentially with jitter (3 s, 6 s, 12 s, then 15 s at most) and goes back to 1.5 s after the next progress. It sends no step while the tab is hidden and picks up again when the tab is shown. A per tab lock means only one step request is in flight, so the two live test sides no longer step at the same time. It stops after 3 failed retries in a row or 40 steps with no progress.
- **Bounded steps** (`src/server/livetest/budget.ts`). Each step runs at most one conversation and gives it what is left of a 50 s budget. If less than 20 s is left after the checks before it, it claims nothing and returns, and the next call does the work. Leases are 30 s, renewed every 10 s. If a route is killed at 60 s, its case is requeued by `recoverStale` within 30 s.
- **Server-Timing** `step;dur=<ms>` on both step routes. `scripts/measure-quick-check.mjs` adds these up for one Quick check.

| Route | maxDuration before | after |
| --- | --- | --- |
| `POST /api/workspaces/{id}/runs/{runId}/step` | 120 | 60 |
| `POST /api/workspaces/{id}/live-test/step` | 120 | 60 |
| `GET /api/workspaces/{id}/reports/{reportId}/pdf` | not set (platform default) | unchanged |
| `POST /api/workspaces/{id}/knowledge/pdf` | not set (platform default) | unchanged |

No route is still at 120. The PDF routes never set a maxDuration and were left alone.

Static assets: Next already serves `/_next/static/*` with `Cache-Control: public, max-age=31536000, immutable`, and that cannot be overridden (see `node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md`). There is no `public/` folder, so `next.config.ts` was not changed.

Measure one Quick check:

```
NAZIR_BASE_URL=https://<deployment> NAZIR_COOKIE='<session cookie name>=<value>' NAZIR_WORKSPACE_ID=<uuid> node scripts/measure-quick-check.mjs
```

This starts a real Quick check, so it uses that deployment's model calls. Set `NAZIR_RUN_ID` to measure a run that has already started.

**Risk to watch.** A conversation used to get 100 s. It now gets at most about 48 s. If free providers are slow, more conversations end with `timeout` and are retried (each retry waits 30 s times the attempt number), up to their attempt limit. The measurement script shows whether this happens.

## Settings changes that would cut usage further (for Adhil to decide, none applied)

1. **Fluid compute / Active CPU billing.** Check that Fluid compute is on for the project. With it, time spent waiting on model and database I/O is not billed as CPU, and that wait is most of a step.
2. **Function region next to the database.** Set the function region (project settings, or `regions` in `vercel.json`) to the Neon region. Every step makes many short queries, so each round trip saves wall time.
3. **Lower default maxDuration for all functions** (project settings, Functions). A lower default caps any route that hangs, for example the PDF routes, which are still on the platform default.
4. **Move run stepping off Vercel.** The box runner (`scripts/runner-run.mjs`) already drives the same queue. Running it on a small always on box for real workspaces would leave Vercel serving only the UI. This is a product decision as well as a settings one.
5. **Daily run cap.** Lowering `maxRunsPerUserPerDay` (`src/server/runner/run-cap.ts`) caps the worst case per person. It is a code constant, but it is a usage policy choice.
6. **Spend management / usage alerts** on the Vercel account, so a spike shows up before the Hobby limit pauses the project.
7. **Drop the demo reset cron** (`vercel.json` crons) or run it less often, if demo workspaces are not in use.
