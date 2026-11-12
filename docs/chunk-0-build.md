# Chunk 0 review handoff

Prepared locally from main `cd94f46`. This is not a live or production completion claim.
Branch `nazir/0-harness-clean-demo` is created outside the Codex sandbox. No production query or Neon migration was made in the build turn.

The only new product copy is `shell.sample`: English **Sample**, Arabic **تجريبي**.
The Arabic draft needs native review. The label appears on seeded Checks, reports,
shared reports and PDFs. Samples are excluded from measured fix comparisons and
Fixed this week. This is a small sample-data guard, not the later Before and after rebuild.

`0036_demo_seed_once.sql` keeps the three day automatic refill rule and the existing
advisory lock. It replaces only rows descended from `demo-seed-%` checks in the fixed
workspace, after checking its kind is still demo. Cleanup deletes comparisons,
reports, approvals, proposals, finding attempts, findings, messages, tool events,
state readings, conversations, runs and their unreferenced plans, in dependency order.
Visitor runs without seed keys survive, even if they reference an old seed plan.
Audit history remains immutable, including its existing chain hashes. Referenced
library data and repaired versions used by visitor checks remain available.

Normal report, message, approval, comparison and audit deletion stays blocked.
The private cleanup functions have no app or worker execute grant. Their delete
guard requires the function owner, cleanup context and seeded demo ancestry together;
a caller-supplied setting alone cannot open the exception. No tables or columns are added.

The second sample uses `planted_false_submit`, including its plan and conversations.
The first uses `planted_wrong_queue`, and the failing question sets differ. A sample
approval no longer claims a passing retest. Explicit reset recycles first, then replaces
the samples immediately once, without waiting for the refill window. The existing
scheduled storage recycling window is unchanged. Stale cancellation is demo only,
after one hour; this path does nothing in real workspaces. The migration also repairs
legacy duplicates and cancels queued or running demo runs older than one hour once.

## Validation

PGlite tests exercise repeat refill, immediate reset, all linked foreign key data,
blocked deletes, forged cleanup settings, workspace boundaries, audit preservation,
and an upgrade from populated 0035 data with duplicate samples. The prior tests that
expected four accumulated reports and a one day demo boundary were updated to two
reports and one hour. Migration inventory tests were updated to include 0036.
No failing tests were deleted. Browser-free audit tests check dead controls,
identical sibling destinations under different URLs, and lost persisted state.
The existing gate remains lint, typecheck, vitest and build.

Offline validation passed: lint (three pre-existing unused-import warnings), typecheck,
and 247 tests across 32 focused files, including database security and migration upgrades.
`git diff --check` and frozen offline lockfile validation passed too.

Playwright is a devDependency. Offline installation could not resolve it from the
cache. The lock entry uses version and integrity values from the existing audit
package lock and passes frozen offline lockfile validation. No browser is required
by lint, typecheck or Vitest. Full build and live audits are left to Bilal because
this sandbox has no network or listening ports. No next.config.ts workaround was added.

## Bilal's live check

1. On a writable checkout, create `nazir/0-harness-clean-demo` from `cd94f46` and
   commit the prepared changes in small groups: migration/reset/stale plus database
   tests; sample labels and report guards plus UI/PDF tests; harness/dependency/docs.
2. Install dependencies with `pnpm install --frozen-lockfile`, then
   `pnpm exec playwright install chromium`. Run `pnpm gate` outside this sandbox.
3. Back up Neon first. Bilal applies only the reviewed pending migration through
   the existing `pnpm db:migrate` process in an authorized environment. Do not
   paste a database URL into a command or audit report. Check `/api/health` afterward.
4. Set `BASE_URL` to the preview site. Run `node scripts/live-audit/signin.mjs`,
   `node scripts/live-audit/crawl.mjs`, then `node scripts/live-audit/persist.mjs`.
   If demo sign in is rate limited, wait for its window before retrying. Scripts
   use Omar and check that the workspace kind is demo. No session files are saved.
5. Read JSON results and screenshots in `/workspace/nazir-mobile-fix/live-0/` for
   390x844 touch and 1440x900, English and Arabic. Crawl exits nonzero for dead
   controls, static cards, failed clicks/screens or duplicate sibling destinations.
   Write controls are recorded as skipped; persistence currently clicks Chunk 0's
   reset and confirmation in Settings, with immediate/reloaded/fresh-sign-in data and screen comparisons.
6. Reset twice. Each time Checks has exactly two labelled samples, different question
   marks, and two seeded fixes. The sample pair must not appear as an approved fix's
   before and after. Check labelled exports and preserved visitor checks and audit history.

No live crawler findings were produced in this sandbox. Known later-chunk gaps remain:
four demo people and role words, Connect absent from Home, device-only fix state,
non-specific detail destinations, and the broader fix lifecycle and navigation work.
The crawler must report these when encountered; they are not waived or fixed here.
