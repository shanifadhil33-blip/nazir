# N06 completion report

Implemented the fictional service agent backend. `pnpm gate` passes: lint, type checking, all 428 tests across 21 files, and the production build. The final verification also ran the JSON test reporter to collect the counts below.

## Files

- `db/migrations/0005_sandbox.sql`: isolated service records, generated references, row policies, role grants, case transitions, append only receipts and worker only seeding.
- `src/server/db/context.ts`, `scripts/db-roles.mjs`: validated sandbox context and trusted login membership, retaining the login attribute check.
- `src/sandbox/demo-rule-pack.ts`, `tools.ts`, `versions.ts`: frozen bilingual rules, sorted JSON hashes, four tools, receipts and version supplied routing.
- `src/sandbox/agent.ts`, `openai-model.ts`, `model-factory.ts`: bounded model loop, safe argument parsing, retry keys, transcript, timeout client and injectable factory.
- `src/app/api/sandbox/agent/route.ts`: token protected HTTP adapter, bounded input, seeding and no-store responses.
- `scripts/sandbox-agent-smoke.mjs`: one English and one Arabic journey with a shared hard provider call cap.
- `tests/sandbox/{agent,model,route,smoke}.test.ts`: 25 new tests using PGlite, scripted models and mocked fetch.
- `tests/db/migrations.test.ts`: updated expected migration list and ledger count to five.
- `docs/service-agent.md`: service, rules, tools, records, configuration and N07 fault injection description.

## Migration and decisions

Existing migration files are unchanged. Cases and escalations check both tenant and requester through row policies, including writes. Composite foreign keys prevent cross tenant parent links. Tool failures roll back their action to a savepoint and then append an error receipt. Advisory transaction locks serialize repeated case creation and review requests. References come from a bounded database sequence; both case and escalation queues come from the supplied version map.

Confirmation, information question handling and response language are model instructions. The tools enforce validation, ownership, routing and database effects. Scripted tests validate execution, not a real provider's judgment. Worker seeding uses a neutral UUID context because sandbox tenant keys are independent of Nazir workspace UUIDs; the worker receives no sandbox table access. Model errors and exhausted turns return a plain fallback without a success claim.

## Tests per file

All files passed.

| File under tests/ | Tests |
| --- | ---: |
| gate.test.ts | 7 |
| health.test.ts | 2 |
| no-ai-look.test.ts | 23 |
| no-dash.test.ts | 8 |
| no-jargon.test.ts | 29 |
| no-optional-copy.test.ts | 5 |
| pages.test.tsx | 4 |
| db/audit.test.ts | 9 |
| db/content.test.ts | 8 |
| db/driver.test.ts | 4 |
| db/live-check.test.ts | 1 |
| db/migrations.test.ts | 3 |
| db/runtime.test.ts | 4 |
| db/security.test.ts | 10 |
| roles/database.test.ts | 136 |
| roles/matrix.test.ts | 86 |
| roles/services.test.ts | 64 |
| sandbox/agent.test.ts | 10 |
| sandbox/model.test.ts | 3 |
| sandbox/route.test.ts | 7 |
| sandbox/smoke.test.ts | 5 |
| Total | 428 |

The smoke script passed syntax checking and lint; its cap passed fake model tests. It was not run against a real model, as requested. No real AI calls, remote database connections, commits or pushes were made. Secret directories were not read. All task edits stayed inside the repository. Pre-existing untracked prompt files were left alone. Nothing else remains unfinished in N06.
