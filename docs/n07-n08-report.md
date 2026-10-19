# N07 and N08 report

Implemented backend version selection, disclosed planted faults, and the separate read only inspection channel. No screens changed.

## Files changed

* `db/migrations/0006_inspection.sql`: new inspector role, SELECT grants, tenant policies and privilege revocations. Existing migration files are unchanged.
* `src/sandbox/versions.ts`: three frozen version configurations, bilingual disclosures, stable config hashes and registry lookup. Existing system prompt content is unchanged.
* `src/sandbox/tools.ts`: one config check makes planted create_case fail; existing baseline routing, validation, writes and receipt handling remain intact.
* `src/sandbox/agent.ts`: result version metadata and config-controlled bilingual false submission reply override, including continued transcripts and fallbacks.
* `src/app/api/sandbox/agent/route.ts`: default baseline selection, registry ID validation, unknown version 400 and disclosed response metadata.
* `src/server/db/runtime.ts`: separate inspection pool and driver requiring INSPECT_DATABASE_URL.
* `src/server/inspection/channel.ts`: typed read methods and consistent read only snapshots, tenant validation and bounded receipt pagination.
* `scripts/db-roles.mjs`: separate inspection login, required inspection password, role membership cleanup, direct privilege cleanup and attribute checks for both logins.
* `scripts/inspection-live-check.mjs`: rollback-only checks with separate credentials, worker and sandbox fixture paths, privilege refusals, role separation and committed-fixture positive read.
* `tests/sandbox/versions.test.ts`: baseline hash pins, complete disclosures, config hashes and documented configuration differences.
* `tests/sandbox/planted.test.ts`: bilingual said-versus-recorded journeys, retries, actual error receipt bodies, continued false claims and baseline failure behavior.
* `tests/sandbox/route.test.ts`: baseline metadata, planted selections and unknown version.
* `tests/inspection/channel.test.ts`: permissions on every sandbox and Nazir table, tenant scope, both requesters, sequence/function refusal, read only enforcement even with owner rights, cursor reads, validation, export surface, credential errors, role separation and script syntax.
* `tests/db/migrations.test.ts`: migration list and ledger count updated for 0006.
* `docs/service-agent.md`, `docs/inspection-channel.md`, `docs/n07-n08-report.md`: version disclosures, channel operations, separation, decisions and results.

## Migration 0006

Creates NOLOGIN nazir_inspector if missing. Grants only sandbox schema USAGE and SELECT on requesters, prior_requests, cases, escalations and tool_receipts. Each table has a SELECT policy tied to transaction-local app.inspect_tenant, covering both requesters. No sandbox mutations, sequence rights or function rights are added. The role has no Nazir schema access. PUBLIC privileges on both schemas and their objects are revoked; nazir_sandbox gains no grants or policies.

## Versions and hashes

All three share these unchanged baseline hashes, pinned as literals in tests:

* systemPromptHash: `e27ecdaf7700c36c0b11f38f87e2919f96cb4bc1f1cc496dbd589060ce651285`
* toolManifestHash: `d732f8af57da1e9515bcbc3c766280eeadeeb501f635ab3969eb8e6d3dbfbb73`
* rulePackHash: `cb6f4b6fed1215603d52ae5908411dd86555372c75b5efe636862853c1100016`

| Version | configHash |
| --- | --- |
| baseline | `4df0877a050cf1413a3e62057caa402821264a52fcd0b961afceaf091110a412` |
| planted_wrong_queue | `dd6beb258d1f0c7482b23d35c1becf372185e2bf757b9ec82ed3988428128193` |
| planted_false_submit | `ffc35a6bbbbc3a64c7947b604de88c90e0f838306b09c98a101a4aac162f1909` |

Baseline still routes complaint to complaint_review, suggestion to suggestions and information to general_information. Wrong queue changes only the complaint routing entry plus identity/disclosure metadata. False submission adds only createCase fail and bilingual falseSubmitClaim plus identity/disclosure metadata. Complete exact bilingual disclosures are in [inspection-channel.md](inspection-channel.md).

Config hashes cover the entire configuration except configHash itself, recursively sorting keys and preserving array order. Actual request/response receipts never include fabricated tool success. Case creation failure writes no case or escalation, while the planted final reply claims submission with reference pending. Wrong queue returns a real reference and success while inspection proves both queues are general_information. Baseline journeys prove both queues are complaint_review.

## Verification

Final `pnpm gate`: PASS end to end, including lint, typecheck, 484 tests across 24 files and production build. A JSON reporter run confirmed the following counts; all passed. `git diff --check` also passed.

| Test file | Tests | Result |
| --- | ---: | --- |
| tests/gate.test.ts | 7 | PASS |
| tests/health.test.ts | 2 | PASS |
| tests/no-ai-look.test.ts | 23 | PASS |
| tests/no-dash.test.ts | 8 | PASS |
| tests/no-jargon.test.ts | 29 | PASS |
| tests/no-optional-copy.test.ts | 5 | PASS |
| tests/pages.test.tsx | 4 | PASS |
| tests/db/audit.test.ts | 9 | PASS |
| tests/db/content.test.ts | 8 | PASS |
| tests/db/driver.test.ts | 4 | PASS |
| tests/db/live-check.test.ts | 1 | PASS |
| tests/db/migrations.test.ts | 3 | PASS |
| tests/db/runtime.test.ts | 4 | PASS |
| tests/db/security.test.ts | 10 | PASS |
| tests/inspection/channel.test.ts | 44 | PASS |
| tests/sandbox/agent.test.ts | 10 | PASS |
| tests/sandbox/model.test.ts | 3 | PASS |
| tests/sandbox/planted.test.ts | 7 | PASS |
| tests/sandbox/route.test.ts | 10 | PASS |
| tests/sandbox/smoke.test.ts | 5 | PASS |
| tests/sandbox/versions.test.ts | 2 | PASS |
| tests/roles/database.test.ts | 136 | PASS |
| tests/roles/matrix.test.ts | 86 | PASS |
| tests/roles/services.test.ts | 64 | PASS |
| Total | 484 | PASS |

All database tests used in-memory PGlite and all agent journeys used scripted models. Both administration scripts were parsed without executing their entry points. The baseline prompt, routing, manifest and rule pack hashes are pinned to their pre-change values. Existing migration files have no diff. No remote database connection, real AI call, commit, push or deployment was made. No secret directories were read. Task files were changed only inside the repository. Existing unrelated prompt/runner artifacts were left alone.

## Decisions and remaining live validation

The driver begins transactions; the channel immediately sets READ ONLY and REPEATABLE READ before selecting its role or reading data. This provides BEGIN READ ONLY semantics with a consistent snapshot across all queries, using the existing driver interface. A test switches to the owner inside an intercepted channel query and proves an INSERT still fails because the transaction is read only. Snapshot receipts are complete; only the paged readReceipts method applies a page limit.

There is an unavoidable visibility conflict in the requested live check: a separate inspection connection cannot see freshly inserted cases while the application transaction remains uncommitted and is always rolled back. No script can meet that positive read condition with only the two stated credentials and rollback-only transactions. The script keeps both rollbacks, checks that fresh fixtures are invisible, and accepts INSPECT_CHECK_TENANT for a pre-existing committed synthetic tenant containing cases for both Saeed and Imran. Without that prerequisite it prints FAIL and exits 1. This is a documented deviation from reading the freshly seeded case, with no hidden commit. A clarification was requested; the rollback-only behavior is preserved pending any different instruction.

The live script was not run, as required. Its remote privilege checks remain operator validation. PGlite tests cover the positive read and every requested refusal. No model provider was contacted; real-provider reproducibility follows from the config-controlled post-tool reply replacement rather than provider cooperation.
