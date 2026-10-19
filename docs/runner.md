# Runner

N10 adds a backend queue and worker. It adds no screens or HTTP routes. The default evaluator returns `inconclusive`, reason `checks_missing`; N11 supplies actual checks. A successful agent reply is never itself evidence that a case exists.

## States

Runs and conversations use the same states:

| From | Allowed next states |
| --- | --- |
| planned | queued, cancelled |
| queued | running, cancelled |
| running | queued for retry, passed, failed, inconclusive, cancelled |
| passed, failed, inconclusive, cancelled | none |

Database triggers enforce this for every role, including the owner. A final row cannot change its status or any result fields. Inconclusive requires a nonblank reason. A conversation's final `result_summary` can be set only once. A retry moves directly from running to queued; it never first writes a final inconclusive row. A final inconclusive conversation can never become passed. Passing a later attempt is possible only while the conversation is still queued or running.

When every conversation is final, the run becomes failed if any failed, otherwise inconclusive if any is inconclusive, otherwise passed if all passed. The inconclusive run reason is `conversations_N`. Cancellation makes the run and its unfinished conversations final immediately and sets `finished_at`; aggregation cannot overwrite it.

## Enqueue and frozen inputs

`enqueueRun` enters `withWorker` for the supplied workspace. It requires an approved plan, approved scenarios in that workspace, and a registry-backed agent version whose `config_hash` matches `getAgentVersion(config.registry_id).configHash`. Unknown IDs and changed configurations are refused. The approved plan supplies the call budget. A workspace/key advisory lock and the unique `(workspace_id,idempotency_key)` constraint make repeated enqueue calls return the same run without adding conversations or another enqueue audit event.

One conversation is created per scenario and repeat, with key `stable_key:language:repeat`. Duplicate scenario IDs are refused. The immutable manifest freezes the registry ID, configuration, prompt, tool manifest and rule pack hashes, scenario IDs and hashes, runner version `n10`, and the configured N09 agent chain order. `manifest_hash` is SHA256 of recursively sorted canonical JSON with array order preserved.

Migration 0008 adds two narrowly scoped hash adapters rather than changing the existing content guard. Exact configurations of the form `{ "registry_id": "baseline" }`, or either disclosed planted version ID, bind to the executable registry's pinned hash. The database kind must match the registry kind, so a planted fault cannot be disguised as baseline. Configurations with extra fields retain the old JSONB hash and are refused by enqueue if they drift. Other configurations and other content hashes keep their existing format. Only N10 manifests use the new canonical manifest hash. This reconciles the earlier JSONB hash format with the sandbox registry's existing canonical hashes without editing the registry.

## Claims, leases and recovery

`nazir.runner_claim(worker,lease_seconds)` is a fixed-search-path SECURITY DEFINER function executable only by `nazir_worker`. It searches across workspaces for the oldest eligible queued conversation or an expired running conversation, locking both the conversation and its run with `FOR UPDATE SKIP LOCKED`. Worker IDs must be short safe identifiers; leases range from 10 to 900 seconds. Workspace context is set internally for audit and restored before returning.

A claim records the owner, lease expiry, heartbeat and attempt tenant. The first attempt is 1. Any subsequent claim after an earlier tenant was assigned increments the attempt, including a queued retry. An expired lease at the attempt limit becomes final inconclusive with `lease_expired`, then claim continues searching. The first claimed conversation starts its run and emits `run_started` once.

Heartbeats run every third of the lease duration. `runner_heartbeat` extends only an unexpired running lease with the matching owner and attempt. A failed heartbeat makes the worker stop. Before each model reservation, sandbox transaction, and final or retry write, the worker checks its lease again. Sandbox transactions lock the conversation before selecting `nazir_sandbox`; a stale model reply cannot trigger sandbox writes. Final evidence and verdict writes share one transaction under a matching running lease. Run locks serialize budget reservations, result aggregation and cancellation. A cancelled or reclaimed conversation rejects the old worker's final result and evidence.

PGlite validates the SQL paths with a single serialized connection. Actual simultaneous PostgreSQL lock contention is not reproduced by these tests.

## A fresh tenant for each attempt

Tenants have the form `r_<conversation UUID without punctuation>_<attempt>`. No attempt tenant is reused. The worker seeds it only through `sandbox.seed_tenant`, then reads a snapshot through `createInspectionChannel(inspectionDriver)`. Any existing case or receipt means `dirty_tenant`; no agent call runs on that tenant.

Reset means selecting a new tenant, not deleting old records. Old cases, receipts and stored evidence remain. The existing sandbox tools provide tenant-scoped action idempotency. Their key remains `conversation_id:tool_name:argument_hash`; identical actions on a fresh tenant cannot reuse a previous tenant's case. Tool evidence stores that action key in `tool_idempotency_key` and a separate invocation key in the existing unique `idempotency_key`, allowing every repeated invocation to retain its own evidence row. Messages and tool events use continuously increasing conversation sequences. All three evidence tables carry an attempt number and retain their existing append-only triggers.

## Calls, deadline and verdict

Each resident turn uses `runServiceAgent`, the frozen registry version, the scenario requester, and the conversation UUID as the conversation key. Production uses `networkChatModel`: N09 `test_run`, PostgreSQL AI storage, correlation IDs, schema validation, and answer metadata. Every actual provider attempt reserves a run call before fetching, including failed attempts and failovers. `calls_used` cannot exceed the copied plan budget. A provider quota reservation may remain charged if a run reservation is subsequently refused, just as an interrupted N09 reservation remains charged. This conservatively preserves provider caps.

Injected plain ChatModels reserve one run call per invocation. A factory returning a `RunnerModel` uses the same network reservation interface as production. Answering provider, model and failover are stored on the conversation and in an attempt-tagged `model_calls` list. N09 stores individual provider attempts without prompt or reply text.

The total conversation deadline defaults to 180 seconds and includes agent turns, inspection and evaluation. The worker races model replies and the evaluator against the deadline, stops new work, and fences late tool replies. It does not depend on a model promise settling to finish a timed-out attempt. A run budget refusal produces final inconclusive `budget_reached`.

The evaluator receives `{ scenario, version, reply, transcript, toolCalls, reading }` and returns `{ status, reason, results }`. Allowed statuses are passed, failed and inconclusive. Other statuses or evaluator exceptions yield `bad_evaluator`. An `AiChainExhausted` detected inside the model wrapper overrides the agent fallback and any evaluator success with `provider_exhausted`. Timeout, budget exhaustion and missing inspection evidence similarly override success. Inspection errors yield `reading_failed`. Reason strings stored as error codes are bounded identifiers; exception text is not persisted in them.

Resident and agent messages, each tool request/response/outcome, and the inspection snapshot are appended as evidence before recording the result. PostgreSQL computes evidence hashes through the existing guards. Evidence reads always use the inspection channel and its separate driver, never the application connection.

## Retries

Only inconclusive outcomes with one of these infrastructure reasons are retried:

- provider_exhausted
- timeout
- lease_expired
- dirty_tenant
- reading_failed

A retry requires `attempt < max_attempts`, moves running to queued and sets `available_at` to the injected current time plus 30 seconds times the attempt. The default limit is three attempts, bounded by the database from one through five. The next claim assigns another tenant. Exhausted expired leases finish immediately with `lease_expired`. Passed and failed are final and are never retried. Budget exhaustion, missing checks, invalid evaluators and version drift are also final inconclusive outcomes.

## Audit

All events go through `nazir.append_audit`. The runner emits `run_enqueued`, `run_started`, `conversation_claimed`, `lease_recovered`, `conversation_retried`, `conversation_finished`, `run_finished` and `run_cancelled`. Cancellation also records completion events for conversations it cancels. Payloads contain IDs, hashes, counts, status/reason codes and provider/model/failover metadata. They contain no transcript text. The existing audit verifier verifies the complete chain after runner execution.

## Scripts

Scripts never read an environment file. Credentials and AI keys come from the process environment. Neither live script is part of the test suite; tests check syntax only.

`pnpm exec node scripts/runner-fixture.mjs` takes `DATABASE_URL_OWNER`. In one owner transaction it takes a fixture lock, finds or bootstraps the synthetic workspace named `Nazir runner fixture`, and creates the demo definitions only once. Bootstrap selects `nazir_worker`; definition setup returns to the owner because workers deliberately have no definition or approval grants. This administration fixture does not grant those rights to workers or relax approval policies. It seeds Omar Mansoor as its fictional member, all three registry versions with disclosures, an approved rule pack, built-in adapter, meaning, two approved scenarios and an approved plan with 60 calls. It commits only after everything succeeds and prints IDs and a PASS line, never the fixture address.

`pnpm exec node scripts/runner-run.mjs` takes `DATABASE_URL` for the app login and `INSPECT_DATABASE_URL` for the separate inspection login. A worker-only fixture lookup returns only the fixed fixture workspace ID; there is no broad workspace read grant. Runtime writes use `withWorker`; sandbox writes use the existing tools. Supply:

| Variable | Meaning |
| --- | --- |
| VERSION | baseline, planted_wrong_queue or planted_false_submit; default baseline |
| LANGUAGES | en, ar or en,ar; default en,ar |
| IDEMPOTENCY_KEY | Required enqueue key |
| MAX_CONVERSATIONS | Processed queue items, default 2, maximum 6 |
| MAX_CALLS | Network calls across the whole process, including failures; default 24, maximum 60 |

The script enqueues the fixture scenarios, then claims queue work until that run is final, no work is currently eligible, or a cap is reached. It does not sleep through retry backoff. Run it again with the same key to continue eligible retries. Claims serve the shared queue, so other eligible runs may consume the process item cap. Output includes conversation status/reason, provider/model/failover, tenant, case references and queues from stored inspection readings, and the run status. It never prints keys, addresses or full transcripts. The default evaluator means a completed journey remains inconclusive until N11 supplies checks.
