# N09 report

Completed backend implementation on 2026-10-19. The gate passes with 553 tests in 28 files, up from 484 tests: 69 new tests. No real AI calls or remote database connections were made.

## Files changed

Added:

- `db/migrations/0007_ai_chain.sql`
- `src/server/ai/providers.ts`
- `src/server/ai/schema.ts`
- `src/server/ai/chain.ts`
- `src/server/ai/store.ts`
- `src/server/ai/chat-model.ts`
- `scripts/ai-chain-probe.mjs`
- `tests/ai/chain.test.ts`
- `tests/ai/store.test.ts`
- `tests/ai/chat-model.test.ts`
- `tests/ai/probe.test.ts`
- `docs/ai-chain.md`
- `docs/n09-report.md`

Updated `tests/db/migrations.test.ts` only to expect the seventh migration and ledger entry. Updated `tests/db/security.test.ts` to assert forced RLS across 26 tables while retaining all tenant checks on the original 23 tables. The old test assumed every Nazir table allowed tenant-scoped direct reads; the AI tables expressly forbid direct reads. The new store tests check denied SELECT, INSERT, UPDATE, DELETE and TRUNCATE for all four service roles, plus denied function execution for nonworkers. No existing security or baseline assertion was relaxed.

Preexisting user prompt/output files under `prompts/` were left untouched.

## Migration 0007

Adds three tables in schema nazir:

- ai_usage: UTC day/task/provider/model reservation and outcome counters.
- ai_cooldowns: model or provider-wide (`*`) expiry and reason.
- ai_calls: timestamp, task, purpose, provider/model/family, outcome/reason, HTTP status, latency, failover, attempt number and nullable workspace/conversation UUIDs.

All three tables enable and force RLS and grant no direct access to service roles or PUBLIC. Worker-only SECURITY DEFINER functions with fixed search paths reserve calls, record attempts, set cooldowns and read current cooldowns/usage. PUBLIC execute rights are revoked. Internal identifier validation is private. Inputs have bounded safe identifiers, fixed task/family/reason vocabularies and nonnegative caps. Reservation checks both totals under one advisory transaction lock, then increments usage atomically. Failed network calls count; local skips do not. Each PostgreSQL adapter operation uses its own transaction with SET LOCAL ROLE nazir_worker.

No prompts, responses, keys or provider bodies are stored. Keys come from the environment; exception messages and provider error text cannot enter attempt records.

## Chains

Agent: Requesty Nemotron ultra, Kilo Nemotron ultra free, OpenRouter Nemotron super free, OVH gpt-oss, OVH Qwen3.5, Z.ai GLM flash, Cloudflare gpt-oss, Gemini flash lite, NVIDIA Nemotron super, Kilo auto free.

Judge: Gemini, Requesty Gemma 4, OVH gpt-oss, Z.ai GLM flash, Cloudflare gpt-oss. A known agentFamily is required. All entries sharing that family are removed; unknown-family Kilo auto is never a judge.

The chain maps OpenAI chat/tool formats to the existing ChatModel contract. Tool arguments must match the supplied JSON schema with exact types, enums, required fields, bounds, patterns, nullable alternatives and extra-property rules. Invalid calls fall through before executing any sandbox tool. Caller validation can also reject an answer. Answer metadata includes all attempts and the initial failed reason. Exhaustion carries structured attempts only.

FIFO provider queues and cached cooldowns are shared by chain instances using the same process clock. All registered providers use one in flight. Requesty starts are at least 12 seconds apart and have a 12 second timeout. OVH starts are at least 30 seconds apart per model. Z.ai has a 45 second timeout; others default to 30 seconds. The chat deadline defaults to 90 seconds and bounds network attempts and queue waits. Aborts do not depend on fetch honoring the signal to settle the caller.

## Failures and caps

- HTTP 429 with daily/quota language: day_used, model cooldown for one hour.
- Other HTTP 429: rate_limited, model cooldown for 60 seconds.
- HTTP 402: payment_required, provider cooldown for 24 hours.
- HTTP 401/403: auth_failed, provider cooldown for 24 hours.
- 5xx, network failures, timeouts, empty/malformed responses and invalid tool arguments: move on without cooldown.
- Missing credentials, active cooldowns, forced faults and refused caps produce no network call. Total deadline stops the chain.

Provider bodies are redacted before classification, truncated to 200 characters and discarded. Attempt/error records contain only fixed reason codes. The fake-key test searches attempts, thrown errors, records and usage for leaked credentials.

Separate daily task budgets: test_run 300, live_demo 400, probe 40. Provider budgets: OpenRouter 20, Requesty 150, Kilo 400, OVH 400, Z.ai 200, Cloudflare 100, Gemini 200, NVIDIA 500. Provider totals span tasks, so they remain a shared boundary even though task allowances are separate. Environment overrides are documented in ai-chain.md; zero disables network use at that boundary.

## Validation

Targeted run, all passed:

| File | Tests |
| --- | ---: |
| tests/ai/chain.test.ts | 43 |
| tests/ai/store.test.ts | 19 |
| tests/ai/chat-model.test.ts | 3 |
| tests/ai/probe.test.ts | 4 |
| tests/db/migrations.test.ts | 3 |
| tests/db/security.test.ts | 10 |
| Total | 82 |

The chain suite covers fixed ordering, independent judge families, missing keys, forced provider/model failures, cooldown classes and expiry, exhaustion, provider timeout and total deadlines, strict invalid tool arguments, caller validation, caps, concurrent Requesty calls and spacing, per-model OVH spacing, cross-instance cooldown sharing and key redaction. Store tests use PGlite for SQL caps, UTC day reset, outcome counts, persisted/expired cooldowns, role denial, private functions, input rejection and absence of prompt/key columns. The adapter runs complete English and Arabic journeys through fake HTTP and real sandbox tools on PGlite, including case status and human review. Another journey rejects malformed tool arguments before creating a case.

Required copy run after targeted tests, all passed:

| File | Tests |
| --- | ---: |
| tests/no-dash.test.ts | 8 |
| tests/no-jargon.test.ts | 29 |
| tests/no-ai-look.test.ts | 23 |
| tests/no-optional-copy.test.ts | 5 |
| Total | 65 |

`pnpm gate` exited 0: ESLint passed, TypeScript passed, all 553 tests across 28 files passed, and Next.js production build passed. `node --check` is exercised by the probe parse test. Probe scenario/cap tests use fake fetch only. All new SQL tests use PGlite. `git diff --check` passed.

The first gate run identified five failures from the older all-tables-are-tenant-tables test assumption. The security test scope correction described above resolved them without granting any new direct table rights. The final complete gate passed.

## Decisions and remaining scope

Model overrides can only select the explicitly listed free IDs for their own provider; they cannot add paid or unknown IDs, change family mappings, or move a judge-only model into agent rotation. A missing or unknown judge agent family is refused because family separation cannot be established. Missing credentials are checked at call time. Groq is absent. OVH Meta-Llama-3_3-70B-Instruct is excluded because it previously returned the boolean as the string "true".

Provider serialization and spacing are process local, as requested. Separate processes sharing an OVH IP may still receive external rate limits. SQL caps and cooldowns are durable across processes; a process crash can leave a reservation without an outcome, still consuming its budget. Record correlation UUIDs have no foreign keys because an AI call can precede creation of its conversation record. Raw validation messages are reduced to fixed invalid_response/invalid_tool_args reasons to avoid sensitive metadata.

The probe supports MAX_CALLS (default 6, maximum 20), forced provider/model IDs, agent/judge purposes and sequential fault scenarios. Its first scenario exhausting returns exit code 1. Only synthetic request content is used, and printed output excludes full responses and credentials. Live provider availability was deliberately not tested. Route/factory integration and screens are outside this phase and were not changed. No requested backend feature remains deferred.

Existing migrations 0001 through 0006, all shared fixtures, versions.ts, demo-rule-pack.ts, system prompt, routing, tool manifest and tool code paths are unchanged. Pinned baseline hashes remain exactly as before and passed the gate. Nothing outside the repository was modified. Neither secrets directory was accessed; no secrets were logged or stored. No git commit/push or Vercel command was run.
