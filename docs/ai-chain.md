# Free AI chain

N09 adds a backend chain, state stores and a ChatModel adapter. It does not change the sandbox route, model factory, system prompt, tools, routing or frozen versions. Registry entries are pinned to the supplied free model IDs. No provider availability or model quality was tested on the network in this phase.

## Registry

All endpoints use OpenAI compatible chat completions. Keys come only from the environment. Missing credentials skip an entry as `no_key`, without reserving usage or sending a request. Cloudflare requires both its token and account ID.

| Provider | Endpoint | Credential | Models and families | Timeout | In flight | Start spacing | Daily provider cap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| requesty | https://router.requesty.ai/v1/chat/completions | REQUESTY_API_KEY | nvidia/nemotron-3-ultra-550b-a55b: nvidia_nemotron; google/gemma-4-31b-it: google_gemma | 12 s | 1 | 12 s across both models | 150 |
| kilo | https://ai-gateway.kilo.ai/api/v1/chat/completions | Keyless | nvidia/nemotron-3-ultra-550b-a55b:free: nvidia_nemotron; kilo-auto/free: unknown | 30 s | 1 | None | 400 |
| openrouter | https://openrouter.ai/api/v1/chat/completions | OPENROUTER_API_KEY | nvidia/nemotron-3-super-120b-a12b:free: nvidia_nemotron | 30 s | 1 | None | 20 |
| ovh | https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions | Keyless | gpt-oss-120b: openai_gpt_oss; Qwen3.5-397B-A17B: alibaba_qwen | 30 s | 1 | 30 s per model | 400 |
| zai | https://api.z.ai/api/paas/v4/chat/completions | ZAI_API_KEY | glm-4.7-flash: zhipu_glm | 45 s | 1 | None | 200 |
| cloudflare | https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions | CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID | @cf/openai/gpt-oss-120b: openai_gpt_oss | 30 s | 1 | None | 100 |
| gemini | https://generativelanguage.googleapis.com/v1beta/openai/chat/completions | GEMINI_API_KEY | gemini-3.5-flash-lite: google_gemini | 30 s | 1 | None | 200 |
| nvidia | https://integrate.api.nvidia.com/v1/chat/completions | NVIDIA_API_KEY | nvidia/nemotron-3-super-120b-a12b: nvidia_nemotron | 30 s | 1 | None | 500 |

OVH Meta-Llama-3_3-70B-Instruct is excluded because preflight observed a boolean emitted as the string `"true"`. Groq is absent. An `AI_MODELS_<PROVIDER>` comma list can select from that provider's listed models, including an empty list to disable it. Unknown or paid IDs are refused. Selection preserves the fixed chain slots and family assignments; changing the list cannot promote a judge-only model into the agent chain.

## Chains and family separation

Agent order:

1. Kilo Nemotron ultra free
2. Requesty Nemotron ultra
3. OpenRouter Nemotron super free
4. OVH gpt-oss-120b
5. OVH Qwen3.5-397B-A17B
6. Z.ai glm-4.7-flash
7. Cloudflare gpt-oss-120b
8. Gemini flash lite
9. NVIDIA Nemotron super
10. Kilo auto free

Judge order: Gemini, Requesty Gemma 4, OVH gpt-oss-120b, Z.ai glm-4.7-flash, Cloudflare gpt-oss-120b. Supply known `agentFamilies` for every family that answered an agent call; all matching family entries are removed before attempting the judge chain. Missing, empty or unknown agent families are refused because separation cannot be established. Kilo auto is never a judge. Judge requests must choose a validation callback suited to their expected answer.

`chain.chat` accepts purpose, task, messages, tools, token limit, temperature, validation callback, agent family or family list, workspace and conversation IDs, and a deadline. The default deadline is 90 seconds for the entire chat; each network attempt also has its provider timeout. Attempts stop when the budget runs out, including time waiting for a provider queue. There are no retries within an entry. All registered providers currently allow one in flight, using FIFO queues shared by chain instances in a process with the same clock. Across processes, caps and cooldowns persist in PostgreSQL; concurrency and spacing remain process local. OVH's external per-IP rate limit can still apply when several processes share an IP.

Tool calls must name a supplied tool and contain JSON arguments that match its schema. The checker supports objects, properties, required fields, additionalProperties=false, exact booleans and numeric types, strings with length/pattern/enum, and anyOf including null. Invalid calls are rejected before any sandbox tool runs. Caller validation can reject an answer too; arbitrary validation text is reduced to `invalid_response` (or `invalid_tool_args`) so it cannot enter metadata.

## Failures and cooldowns

| Failure | Reason | Action |
| --- | --- | --- |
| 429 mentioning per day, per-day, daily, neurons, free-models-per-day or quota | day_used | Cool the model for one hour |
| Other 429 | rate_limited | Cool the model for 60 seconds |
| 402 | payment_required | Drop all provider models for 24 hours |
| 401 or 403 | auth_failed | Drop all provider models for 24 hours |
| 5xx | http_5xx | Move on without cooldown |
| Network failure | network | Move on without cooldown |
| Provider timeout | timeout | Abort and move on without cooldown |
| Empty text without tool calls, non JSON, malformed choices or call shape | invalid_response | Move on without cooldown |
| Unknown tool or arguments failing JSON/schema checks | invalid_tool_args | Move on without cooldown |
| Total deadline | deadline | Stop the chat |

Active model and provider cooldowns are skipped as `cooling`. Provider cooldown rows use model `*`. Cooldowns are read once at the start of each chat and also cached across chain instances sharing the process clock for concurrent calls. A later shorter cooldown never shortens an existing one.

Other local reasons are `no_key`, `forced_down`, and `cap_reached`. `dropped` is reserved in the record vocabulary; active provider drops use `cooling`. Error bodies are redacted of environment credentials before classification, limited to 200 characters and discarded. Raw provider bodies and exception messages are never included in chain errors or records. When every entry fails, `AiChainExhausted` carries only the structured attempts.

Successful replies include content, mapped tool calls and metadata: answering provider/model/family, attempts, failover and the first failed reason. Slots skipped only because no key is configured (no_key) do not count toward failover, so a judge chain that starts at Requesty because Gemini has no key is not tagged; every other earlier attempt (cooling, cap_reached, forced_down, errors) does. Replies whose message has no content field at all (OVH gpt-oss and Requesty on a tool call, seen in the live probe on 19 Oct) are read as content null.

## Daily budgets and storage

UTC task budgets default to test_run=300, live_demo=400, probe=40. Set `AI_DAILY_CAP_TEST_RUN`, `AI_DAILY_CAP_LIVE_DEMO` or `AI_DAILY_CAP_PROBE` to change them. These totals are separate: test calls do not use the live task allowance. Each provider also has the shared cross-task cap in the registry table; OpenRouter is limited to 20 because its free allowance is shared with the team. Override a provider cap with `AI_PROVIDER_CAP_<ID>` using uppercase ID. Caps are nonnegative integers; zero disables network use at that boundary.

Immediately before each network attempt, the store atomically reserves one call against both budgets. Failed network attempts count. Local skips, forced faults and refused reservations do not. SQL reservations serialize under a transaction advisory lock, preventing concurrent task or provider totals from exceeding a cap. A new UTC day starts new totals. An interrupted process may leave a reserved call without an outcome, which still counts toward the budget.

Migration 0007 adds `nazir.ai_usage` (day/task/provider/model counters), `nazir.ai_cooldowns` (expiry and fixed reason) and `nazir.ai_calls` (attempt metadata). Tables have enabled and forced RLS with no direct service role grants. Only nazir_worker can execute the five narrow SECURITY DEFINER entry points with fixed search paths: ai_reserve, ai_record, ai_cool, ai_active_cooldowns and ai_usage_today. The identifier checker is internal. The PostgreSQL adapter uses a fresh transaction and SET LOCAL ROLE nazir_worker for every operation. Memory storage accepts a clock for isolated tests and the probe.

Recorded attempts contain timestamp, task, purpose, provider, model, family, outcome, fixed reason, HTTP status, latency, failover, attempt number and nullable workspace/conversation UUIDs. No prompt, response text, provider body or key is stored. Failed or skipped records cannot receive provider exception text through the adapter. Correlation UUIDs have no foreign key because calls may precede a run/conversation record.

## Adapter and probe

`chainChatModel` adapts the chain to the existing ChatModel contract for agent purpose and enables schema validation. Supply task and correlation IDs; `onCall(meta)` receives each answered call's metadata. Sandbox route and model factory integration are deferred from this phase.

`forcedDown` accepts provider IDs or `provider/model` IDs. It records `forced_down` without fetching, reserving or cooling. `scripts/ai-chain-probe.mjs` uses a fixed synthetic Arabic create_case request, memory storage and the same chain. MAX_CALLS defaults to 6 and has a hard maximum of 20 network attempts, counting failures. PROBE_FORCE_DOWN is a comma list; PROBE_PURPOSE is agent or judge; judge also needs PROBE_AGENT_FAMILY. The probe validates that a tool call was returned. It is a transport/tool probe, not a judge-quality evaluation.

With `--scenarios`, calls run sequentially with the configured fault set, then the first answering provider added to that set, then the next answering provider added too. It stops when the shared cap is spent or a scenario exhausts. The first scenario exhausting returns exit code 1. Output contains one line per attempt and the answering provider/failover flag, never full replies or keys. It loads TS with the same Node hooks as the sandbox smoke script. Do not run it as part of the gate. Unit tests exercise helpers with fake fetch; `node --check scripts/ai-chain-probe.mjs` checks parsing without network traffic.

The 19 October agent order prefers Kilo ultra free, then Requesty ultra, based on the supplied live transport observations. All other slots and the judge order retain their earlier order. This phase made no live provider calls. The semantic judge and its calibration method are documented in [judge.md](judge.md).
