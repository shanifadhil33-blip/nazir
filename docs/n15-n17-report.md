# N15 to N17 report

Built by hand (Bilal, Oct 20 2026) because the box network went down right after the Codex launch, so Codex could not reach its service. No usage limit was hit.

## N15 repairs
Migration 0014, src/server/repair (executable, retest, proposals, evidence digest). Supplier proposes, reviewer decides with a reason, four eyes in code and in the database. Approval creates a frozen repair version and two approved plans (retest: affected, normal, retry, unseen hidden; frozen suite: every approved scenario once). Old records keep the same evidence digest. Tests: tests/repair (6).

## N16 memory
Migration 0015, src/server/memory (effects, lessons, talk, planner, frozen). "Should I remember this?", What I've learned (list, edit, delete, undo, history), talk to correct through the free AI chain with a plain fallback, big lessons wait for the owner, lessons order the next plan and are frozen into the run and named in findings, workspace separation. Tests: tests/memory (8).

## N17 comparison
Migration 0013, src/server/compare. Pairs by scenario, language and repeat; denominators; regressions; inconclusive counted apart; failover per conversation; settings that differ; language parity. Tests: tests/compare (10).

## Part 0
Runner CLI picks one scenario per stable key and language, library rows first. Root cause: queue checks after a failed create with no case are adapter_failure; a false claim is adapter_failure or workflow_failure from the receipts and record checks.

## Gate
lint, typecheck, 1155 tests (50 files), build: pass.

## Not done this turn (network down)
Neon migrations 0013 to 0015, the three live checks, pnpm audit, push and the Vercel deploy. The scripts are ready: scripts/repair-cycle.mjs, scripts/memory-check.mjs, scripts/compare-versions.mjs. The Neon library fixture also needs one rerun of scripts/runner-library-fixture.mjs to add the supplier member Yusuf Rahman.
