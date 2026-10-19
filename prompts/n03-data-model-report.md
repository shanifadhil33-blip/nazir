Implemented N03 backend: 23 tables, workspace RLS, composite foreign keys, immutable evidence, append-only audit chain, database contexts, administration scripts and health checks.

Three migrations: `0001_core.sql`, `0002_rls.sql`, `0003_audit_chain.sql`. Code is under `src/server/db/`, `src/server/audit/`, `scripts/` and `tests/db/`.

Documentation: [data model](/workspace/nazir/docs/data-model.md) and [audit format](/workspace/nazir/docs/audit-chain.md).

**`pnpm gate` passed**: lint, strict typecheck, 117 tests and production build.

| Test file | Passed |
|---|---:|
| db/migrations.test.ts | 3 |
| db/security.test.ts | 10 |
| db/audit.test.ts | 9 |
| db/content.test.ts | 8 |
| db/driver.test.ts | 4 |
| db/runtime.test.ts | 4 |
| db/live-check.test.ts | 1 |
| health.test.ts | 2 |
| gate.test.ts | 7 |
| pages.test.tsx | 4 |
| no-ai-look.test.ts | 23 |
| no-dash.test.ts | 8 |
| no-jargon.test.ts | 29 |
| no-optional-copy.test.ts | 5 |

Decisions: audit sequences remain strings to preserve bigint precision; scenario hashes exclude metadata to stay stable across timezones. Approval authority remains deferred to N05.

Remote administration scripts were not run; the rollback-only live check passed locally on PGlite. No UI, commits, pushes, env-file changes or changes outside the repo.