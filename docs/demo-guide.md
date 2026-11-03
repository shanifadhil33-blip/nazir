# Demo guide

For judges and for the handover. All people, records and services in the demo are fictional.

## What the demo workspace is

Signing in with Google creates a home workspace of kind `demo` with a sample agent, the "Fictional Service Agent", on its baseline version, and the Government Focus Pack (`src/server/auth/home-seed.ts`). There is no pre-loaded history: the first Quick check creates the first plan, run, score and findings. Seeding is safe to repeat, because anything already present is reused.

The sample agent runs in a separate sandbox schema with synthetic requesters and records. Sample people have male names. Texts are in English and Arabic, and the page can switch between them.

The landing page shows a read only sample report (marked "Sample data") so a visitor can see the shape of a result before signing in.

## Path for a judge

1. Open the site and tap **Sign in**. The button shows "Signing you in" while Google responds.
2. You arrive at your workspace. Nothing is running yet, and the first step on screen is **Run Quick check** (16 tests, English and Arabic).
3. Run the Quick check. Progress shows while the tests run, and a run continues if you close the page (B3).
4. Open the **score**. You get an overall score. The report states the tested scope and is not a certificate.
5. Open the **findings**. Each one shows what the agent said, what really happened in the records, and the evidence.
6. Open a finding and **propose a repair**. A repair is a proposed fix to the agent's instructions, shown in plain words, and you can edit it.
7. A service quality reviewer **approves** the fix with a reason. Nobody approves their own proposal. This rule is enforced in the code and in the database, including for a one person workspace, and the demo does not bypass it.
8. **Recheck** the fix. The result of the recheck is shown against the earlier one.
9. Open the **report**. It can be read in English or Arabic and downloaded as a PDF.

Planted faults to look for are listed in [demo-faults.md](demo-faults.md).

## Keeping the demo clean

* A scheduled job (`/api/cron/demo-reset`, daily) trims demo storage to its cap, and since B6 it also cancels runs that have been queued or running for over a day. The member reset (`POST /api/workspaces/{id}/demo-reset`, service owner only) does the same on demand. Both refuse a real workspace and are safe to run twice.
* Finished plans and runs are never deleted. They are immutable on purpose, and nobody holds delete rights on them.
* `node scripts/demo-cleanup.mjs` is a dry run that prints counts of stuck runs, cancelled plans and runs, old proposed plans and QA leftovers in demo workspaces. `--apply` cancels only the stuck runs, in one transaction. `--workspace <uuid>` limits it to one demo workspace. It needs `DATABASE_URL` and must be run by a person who intends to, never from the build. A test fixture whose plan goal starts with "test", "qa", "smoke" or "probe" is counted as a QA leftover, but is only reported.
