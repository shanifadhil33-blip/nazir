# N10 report

Completed backend runner implementation on 2026-10-19. The final `pnpm gate` exited 0: lint, typecheck, 813 tests in 32 files, and the production build passed. N10 adds 258 tests in four files. No screens or HTTP routes were added.

## Files changed by N10

Added:

- `db/migrations/0008_runner.sql`
- `src/server/runner/demo-scenarios.ts`
- `src/server/runner/enqueue.ts`
- `src/server/runner/worker.ts`
- `src/server/runner/network-model.ts`
- `src/server/runner/cancel.ts`
- `src/server/runner/fixture.ts`
- `scripts/runner-loader.mjs`
- `scripts/runner-fixture.mjs`
- `scripts/runner-run.mjs`
- `tests/runner/helpers.ts`
- `tests/runner/state.test.ts`
- `tests/runner/queue.test.ts`
- `tests/runner/worker.test.ts`
- `tests/runner/scripts.test.ts`
- `docs/runner.md`
- `docs/n10-report.md`

Updated `tests/db/migrations.test.ts` only to include migration 0008 and expect eight ledger rows. Added one queued transition to the existing manifest immutability test in `tests/db/content.test.ts`: planned must now pass through queued before running. Its existing assertions remain intact. This is necessary to test manifest immutability under the new state machine rather than retaining a newly forbidden transition.

Concurrent edits appeared in `src/server/ai/chain.ts`, `tests/ai/chain.test.ts` and `docs/ai-chain.md` while this task was running. They were preserved without modification by N10. They add two N09 tests, explaining the full count: 553 previously reported tests, two concurrent N09 tests, and 258 N10 tests equals 813. Existing untracked prompt files were left untouched.

## Migration 0008

The migration replaces the run and conversation status checks with planned, queued, running, passed, failed, inconclusive and cancelled. A trigger applies to all roles. It allows planned to queued/cancelled, queued to running/cancelled, and running to queued or any final state. Final rows cannot change. Inconclusive requires a nonblank reason, and a nonnull final result summary cannot be replaced.

Runs gain workspace-scoped enqueue idempotency and a positive call budget copied from their plan. Existing run budgets are backfilled from plans; the insert trigger supplies the plan budget for callers that omit it. Conversations gain availability, bounded attempt limits, short error codes, heartbeat, pinned agent/scenario identity, final result JSON and attempt-tagged answering-model metadata. Evidence gains attempt numbers, and tool events also retain the actual sandbox action key separately from their unique invocation key. Existing evidence immutability, grants and RLS rules remain intact.

Worker-only claim and heartbeat functions use SECURITY DEFINER and fixed search paths. Claim validates worker identifiers and lease bounds, locks eligible conversations and their runs with SKIP LOCKED, recovers expired leases, assigns a fresh tenant, and starts a queued run exactly once. An exhausted expired lease becomes final inconclusive and claim continues. Workspace context is restored before returning. Heartbeats refuse wrong owners, wrong attempts, expired leases and nonrunning rows.

Additional functions provide workspace-scoped aggregation, a pure canonical JSON helper, narrow registry hash adapters, and a fixed-name fixture workspace lookup. No existing migration was edited. No existing policy, role rule or table grant was relaxed, and no new grant was made to app, sandbox or inspector roles.

## Worker and evidence

The worker seeds only through `sandbox.seed_tenant`, then checks the tenant through the inspection channel. Existing cases or receipts yield dirty_tenant before an agent call. Every attempt gets `r_<conversation UUID>_<attempt>`; retries preserve old sandbox records and append new attempt-tagged evidence.

Resident turns use the frozen registry version, the conversation UUID as conversation key, and the scenario requester. Production uses the real N09 chain with test_run and PostgreSQL AI storage. Each provider attempt, including failed attempts and failovers, reserves a run call before fetch. Atomic run updates enforce the plan budget. Plain scripted models reserve once per model invocation. The process script separately caps all network calls across conversations.

The worker renews every third of its lease and stops after a rejected heartbeat. Each sandbox transaction is fenced by a locked, live matching lease before selecting nazir_sandbox. Model reservations and final writes take the run lock before the conversation lock; claim skips locked run/conversation pairs. Evidence and final/retry writes share a transaction conditional on owner, attempt and running status, with an additional unexpired-lease check. A cancelled or superseded worker cannot overwrite the new attempt or append its result evidence.

The default total deadline is 180 seconds. Slow model responses and a hanging evaluator cannot hold an attempt open indefinitely. Late model tool replies cannot write after timeout or lease loss. Provider exhaustion is detected in the model wrapper before runServiceAgent converts model exceptions to its fallback. Exhaustion, timeout, budget refusal and missing readings override a passed evaluator. Bad statuses or evaluator exceptions yield bad_evaluator. The default evaluator yields checks_missing.

Messages, complete tool request/response/outcome evidence, action and invocation keys, inspection snapshots and hashes are stored. Reading occurs only through createInspectionChannel using the separately supplied inspection driver. Conversation model metadata keeps every answered call across attempts. Final summaries include evaluator results and answering call metadata.

## Retry and aggregation rules

Only infrastructure inconclusive reasons are retried: provider_exhausted, timeout, lease_expired, dirty_tenant and reading_failed. Retry requires remaining attempts and sets availability to current time plus 30 seconds times the current attempt. It moves running directly to queued and leaves the final summary unset. The next claim increments the attempt and changes tenant.

Passed and failed are never retried. Budget exhaustion, checks_missing, bad_evaluator and version drift are final inconclusive outcomes. A final inconclusive row cannot later become passed. Tests prove that a retried attempt with an earlier case creates exactly one case in a new tenant while the original tenant stays intact.

Aggregation waits until every conversation is final, then chooses failed if any failed, inconclusive if any is inconclusive, and passed only if every conversation passed. Inconclusive run reasons contain the count. Cancellation freezes the run immediately and cancels every unfinished conversation; later evaluator success cannot change it.

Audit uses only append_audit and includes run_enqueued, run_started, conversation_claimed, lease_recovered, conversation_retried, conversation_finished, run_finished and run_cancelled. Payloads contain identifiers, bounded codes, counts, hashes and model metadata, with no transcript text. The complete chain verifies after execution.

## Validation

Final targeted run, all passed:

| File | Tests |
| --- | ---: |
| tests/runner/state.test.ts | 206 |
| tests/runner/queue.test.ts | 17 |
| tests/runner/worker.test.ts | 32 |
| tests/runner/scripts.test.ts | 3 |
| tests/db/migrations.test.ts | 3 |
| tests/db/content.test.ts | 8 |
| Total | 269 |

The state suite covers the complete transition matrix for both tables as owner and worker, blank reasons on insert/update, and immutable final result fields. Queue tests cover enqueue idempotency, canonical hashes, plan/scenario approval and workspace checks, drift and disguised planted faults, FIFO eligibility, live leases, reclaim, exhausted leases, role denial, identifiers, heartbeat matching and workspace isolation.

Worker tests cover both languages and all three versions with the real sandbox journey; correct, wrong and missing case readings; default and scripted evaluators; real N09 exhaustion with fake fetch; retry after case creation; timeout and late replies; hanging evaluation; model and provider-level budgets; failures that never retry; lease takeover; cancellation; aggregation; answer metadata; repeated tool calls; dirty tenants; inspection errors; attempt limits; periodic heartbeat success/failure; fixture idempotency; audit verification and absence of transcript text in audit payloads. All database tests use PGlite. No AI network call is used in testing.

Required copy tests ran separately after the final targeted run, all passed:

| File | Tests |
| --- | ---: |
| tests/no-dash.test.ts | 8 |
| tests/no-jargon.test.ts | 29 |
| tests/no-ai-look.test.ts | 23 |
| tests/no-optional-copy.test.ts | 5 |
| Total | 65 |

The final end-to-end gate passed with 813 tests in 32 files and a successful Next.js production build. `git diff --check` passed. The pinned sandbox version tests passed unchanged. Script tests parse all three new JavaScript files with node --check without executing either live script.

## Decisions and limits

The existing database hashes configuration JSONB, while the registry hashes canonical executable configurations. Exact supported registry references therefore receive their pinned registry hashes through a new trigger. A kind check prevents disguised planted versions; configurations with extra fields keep the previous hash behavior. N10 manifests use their own canonical hash adapter. No baseline source, prompt, routing, manifest or hash assertion changed.

Evidence invocation keys and sandbox action keys are separate so repeated calls and retries can retain every evidence row without dropping the existing unique constraint. Old evidence is never rewritten or deleted. A provider quota reservation can remain charged if a subsequent run budget reservation refuses the fetch; this conservatively preserves provider caps.

The administration fixture uses owner rights for definition and approval setup after worker-only bootstrap, because the existing worker deliberately has no such grants. Runtime execution writes remain under withWorker, and sandbox writes remain under the existing tools. The fixture commits only at the end of one transaction. It never prints the fixture member address. The run script uses the fixed fixture lookup rather than broad cross-workspace reads, and prints only safe execution summaries. It exits when no work is currently eligible; rerunning the same enqueue key continues retries after backoff. The shared queue can process another run before the requested run, within the same process caps.

PGlite cannot reproduce simultaneous connections or production PostgreSQL lock contention. No live PostgreSQL, provider availability or real-model quality claim is made. The default checks_missing evaluator is intentional N11 scope. No requested N10 backend feature is left deferred.

This N10 work made no real AI calls, remote database connections, commits, pushes or Vercel calls. Neither live runner script was run. Node v22.23.3 was checked, and shell commands used the required Node 22 PATH prefix and pnpm. No secrets directory was accessed; keys were neither logged nor stored. No file outside the repository was changed by this work. Migrations 0001 through 0007, src/sandbox files, shared tests/helpers fixtures and pinned baseline assertions remain unchanged.
