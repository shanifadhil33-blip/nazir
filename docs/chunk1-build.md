# Chunk 1 build handoff

Prepared in the working tree on main at 1fac35d. Bilal should create nazir/1-background-runner outside this sandbox. No branch, commit, push, merge, build or production migration was performed. No package install command or network access was used; existing repo cache files restored node_modules locally.

Arabic drafts in messages/ar.json require native review. The five keys are checksScreen.progress, stopCheck, stopped, notChecked, and historyScreen.checkStopped. Report and PDF reuse checksScreen.stopped.

## Migration, prepare only

0037_runner.sql adds only nazir.runner_pending(integer). Its fixed search path and worker-only grant expose three IDs, including terminal work still missing its final report. Existing runner_claim signatures, table RLS and FORCE settings remain unchanged. Fresh and upgrade migrations passed on PGlite.

Bilal must make the Neon backup branch and obtain the required approval before applying pnpm db:migrate outside the sandbox. Then verify /api/health. No database URLs or secrets are needed in this handoff.

## Verification

Node 22.23.3: lint passed with three existing unused-import warnings in after.tsx and frame.tsx. Typecheck passed. The full offline suite passed: 153 files, 2463 tests passed, 2 existing loader tests skipped by their version guard. Final focused validation after the last report safeguards passed: 36 files, 515 tests passed, the same 2 loader tests skipped. git diff --check and the crawler syntax check passed.

Existing failing expectations were updated for eight by one, Full by three, terminal-only reports, approved copy and the migration list. No tests were deleted or newly skipped. next build and the full gate still require Bilal outside the sandbox.

## Live checks and known gaps

Production unique `VERCEL_URL` hosts are SSO protected, so the runner must tick the public `AUTH_URL` origin. `AUTH_URL` was added in production for this reason and takes effect on the next deploy. It must win over both Vercel URL fallbacks, since another production alias is also SSO protected.

1. Deploy the preview after the migration preparation and outside-sandbox gate. Confirm CRON_SECRET is configured and the configured deployment tick URL accepts the internal authenticated POST. Do not print the secret. The existing daily demo-reset cron stays unchanged.
2. At 390, start a check and close the browser within five seconds after Start succeeds. Open a fresh browser about two minutes later. Record Start to report time and require under three minutes.
3. Keep a second signed-in browser open during another check. Verify shared progress and Stop from that browser. Quick must end at 8 of 8; Full counts every repetition.
4. Confirm completed checks with wrong answers still score normally. Stopped checks must show progress, Not checked questions, stopped History, no score or improvement, and matching PDF and shared-report behavior.
5. Run crawl.mjs and persist.mjs on preview, then production after Bilal merges and deploys. Verify 390 and 1440, EN and AR, Fixes bottom clearance, Back and reload. Save the required screenshots outside this sandbox.

Legacy queued or running checks without trusted run_enqueued attribution are skipped and left untouched. PGlite covers this; live legacy counts were not queried. The runner also excludes inactive starters and revalidates starter permissions on every transaction.

The close-phone path is server after() scheduling, not the browser kick. If the platform loses the complete after() chain, no independent watchdog was added; a later authenticated kick can recover leases. Live Vercel chaining, deployment access, provider rate limits and the one-to-two-minute target remain unverified here.

Fixes and History device storage, the broader fix lifecycle, role simplification and navigation work remain in their later chunks. Chunk 1A was not started. Home and Connect were not rebuilt.

## Suggested small commits

1. Chunk 0 crawler and phone clearance with harness coverage.
2. Versioned Quick selections, planning, repetition and progress coverage.
3. Runner discovery, lock, scheduling, authenticated routes and runner coverage.
4. Checks polling, truthful completion, reports, copy, previews and remaining regression updates.

## Files changed, one line per file

- `db/migrations/0037_runner.sql`: Add worker-only discovery of trusted run, workspace and starter IDs with a fixed search path. No tables, columns or claim changes.
- `messages/ar.json`: Apply the five approved EN and AR copy keys. Arabic drafts require native review.
- `messages/en.json`: Apply the five approved EN and AR copy keys. Arabic drafts require native review.
- `scripts/live-audit/crawl.mjs`: Wait for delayed query navigation, exclude hidden ancestors, recheck visibility and retain dead-control and sibling failures.
- `src/app/api/runner/tick/route.ts`: Authenticate POST ticks with secretMatches, respond immediately, and own work and continuation through after().
- `src/app/api/workspaces/[workspaceId]/runs/[runId]/cancel/route.ts`: Schedule report finalization after a committed stop.
- `src/app/api/workspaces/[workspaceId]/runs/[runId]/kick/route.ts`: Expose an authenticated member kick for this run.
- `src/app/api/workspaces/[workspaceId]/runs/route.ts`: Expose authenticated shared active progress.
- `src/app/globals.css`: Add phone clearance below Fixes, including the safe area.
- `src/components/ocean/model.ts`: Carry stopped status into the existing shared-report view and suppress partial baselines.
- `src/components/ocean/screen.tsx`: Hide scores and measured improvement for stopped shared reports.
- `src/components/shell/checks-model.ts`: Retain unasked questions and present stopped progress truthfully.
- `src/components/shell/checks-preview.tsx`: Keep the existing preview compatible with stopped progress copy.
- `src/components/shell/checks-run.ts`: Remove the unused browser driver and session key; read progress and send supplemental kicks.
- `src/components/shell/checks-screen.tsx`: Poll every five seconds, kick about every twenty seconds, and refetch after start and stop without device state.
- `src/components/shell/checks.tsx`: Show every active check, Stop, try progress and Not checked.
- `src/components/shell/fixes-model.ts`: Suppress measured before-and-after results for partial checks.
- `src/components/shell/history-model.ts`: Distinguish completed checks with wrong answers from stopped checks.
- `src/components/shell/home-screen.tsx`: Only select completed reports for Home scores and the existing first-check state.
- `src/components/shell/more-preview.tsx`: Supply complete report fixtures to the existing History preview.
- `src/components/shell/report-model.ts`: Exclude partial reports from measured improvements and carry stopped progress.
- `src/components/shell/report.tsx`: Show stopped progress without a score or fixed-this-week claim.
- `src/server/compare/compare.ts`: Refuse stopped or partial checks before calculating improvement.
- `src/server/db/runtime.ts`: Reserve an advisory-lock session and release it or destroy it after every tick.
- `src/server/livetest/budget.ts`: Define the 240 second tick budget and parallelism four.
- `src/server/livetest/drive.ts`: Return tries_done and tries_total while retaining question verdicts.
- `src/server/memory/planner.ts`: Preserve the chosen repetition count through approval and prevent Quick lesson overrides.
- `src/server/packs/clinics/pack.json`: Version Quick as 2.0.0 with four EN and four AR questions covering all planted fault families; archive 1.0.0.
- `src/server/packs/ecommerce/pack.json`: Version Quick as 2.0.0 with four EN and four AR questions covering all planted fault families; archive 1.0.0.
- `src/server/packs/government/pack.json`: Version Quick as 2.0.0 with four EN and four AR questions covering all planted fault families; archive 1.0.0.
- `src/server/packs/quick.ts`: Validate balanced versioned selections and retain the earlier sixteen-question selection.
- `src/server/packs/real-estate/pack.json`: Version Quick as 2.0.0 with four EN and four AR questions covering all planted fault families; archive 1.0.0.
- `src/server/packs/schema.ts`: Validate eight current Quick keys and the archived selection.
- `src/server/packs/schools/pack.json`: Version Quick as 2.0.0 with four EN and four AR questions covering all planted fault families; archive 1.0.0.
- `src/server/planner/bound.ts`: Propose eight Quick questions with one repetition and keep Full at three.
- `src/server/reports/build.ts`: Carry completion and progress in report JSON and preserve partial status in restricted projections.
- `src/server/reports/measured.ts`: Exclude every conversation belonging to a partial or cancelled check from aggregate measurements.
- `src/server/reports/pdf.ts`: Reuse stopped copy and omit partial scores and measured improvement.
- `src/server/reports/read-pdf.ts`: Require a complete saved baseline before presenting a measured before score.
- `src/server/reports/read.ts`: Create only terminal reports, once per run under a transaction advisory lock.
- `src/server/runner/context.ts`: Revalidate the trusted starter and workspace in every worker transaction.
- `src/server/runner/enqueue.ts`: Schedule after commit and enforce new Quick repetitions without changing frozen runs.
- `src/server/runner/runs.ts`: Read shared progress and authorize and coalesce member kicks.
- `src/server/runner/schedule.ts`: Use after() to send authenticated ticks only to the configured deployment, with bounded retries.
- `src/server/runner/tick.ts`: Recover leases, use up to four parallel claims, reduce to three on provider exhaustion, continue and finalize reports.
- `tests/auth/shell-data.test.ts`: Finalize the fixture before creating its terminal report.
- `tests/compare/compare.test.ts`: Keep pair classification coverage and refuse partial improvement measurements.
- `tests/db/migrations.test.ts`: Expect migration 0037 in the ordered migration ledger.
- `tests/library/new-cases.test.ts`: Expect eight Quick questions while keeping Full library coverage intact.
- `tests/live-audit/harness.test.ts`: Test delayed same-path navigation, hidden ancestors, genuine dead controls and duplicate siblings.
- `tests/livetest/live-test.test.ts`: Update progress expectations to count all repetitions.
- `tests/no-checks-session-state.test.ts`: Guard only the Checks start, stop and progress path against device state and browser driving.
- `tests/packs/quick-flow.test.ts`: Exercise eight by one in all five packs, Full by three, and unchanged frozen sixteen by three checks.
- `tests/packs/quick.test.ts`: Check versioned balanced selections, every planted family and archived compatibility.
- `tests/reports/completion.test.tsx`: Verify wrong answers remain completed, partial projections stay partial, and UI, History and PDF omit partial scores.
- `tests/reports/measured-db.test.ts`: Use completed measurement fixtures and prove stopped answers are excluded.
- `tests/reports/pdf-route.test.ts`: Finalize the fixture before exporting its terminal report.
- `tests/reports/pdf.test.ts`: Expect stopped progress instead of a fabricated zero score for empty work.
- `tests/reports/report.test.ts`: Assert active report creation is refused and terminal authorization still holds.
- `tests/runner/lock.test.ts`: Verify session reservation, unlocking and destruction on failure without a long transaction.
- `tests/runner/repeats.test.ts`: Update Full approval expectations to three repetitions.
- `tests/runner/schedule.test.ts`: Verify secret authentication, initial scheduling after commit, response ownership and continuation without a browser.
- `tests/runner/tick.test.ts`: Exercise real PGlite claims, concurrency, contention, recovery, isolation, legacy skips, stop races, finalization and provider backoff.
- `tests/runner/upgrade.test.ts`: Expect 0037 while proving historical evidence remains unchanged.
- `tests/ui/checks.test.tsx`: Update the approved Stop and progress wording.
- `tests/ui/home-completion.test.tsx`: Verify Home selects completed scores and uses its existing first-check state when all reports are partial.
- `tests/ui/more.test.tsx`: Supply explicit completion state in History and Report fixtures.
- `docs/chunk1-build.md`: Record migration preparation, verification, native review, live checks and this file inventory.
