# Nazir phase N11: record checks over the inspection reading (Codex task)

Repo /workspace/nazir. N02, N03, N05 to N10 are in place. Read docs/service-agent.md, docs/inspection-channel.md, docs/runner.md, docs/n10-report.md, src/sandbox/*, src/server/inspection/channel.ts, src/server/runner/*, tests/runner/*, tests/sandbox/planted.test.ts and tests/inspection/channel.test.ts first. Backend only, no screens, no new HTTP routes.

## Environment rules (must follow)
- Start EVERY shell command with: export PATH=/home/box/.local/node22/bin:$PATH && ... (check once that node --version prints v22).
- pnpm only. Do not git commit or push, do not run vercel, never connect to a remote database, never read /workspace/nazir-secrets or /workspace/secrets, make NO real AI calls (tests use scripted models or a fake fetch). Tests run on PGlite.
- Never edit existing migration files; if a migration is needed add `db/migrations/0009_checks.sql` (probably none is needed).
- Only change files inside /workspace/nazir. Keep every existing test green, including the project wide copy tests tests/no-dash.test.ts, tests/no-jargon.test.ts, tests/no-ai-look.test.ts and tests/no-optional-copy.test.ts (no " - ", en dash or em dash in string literals under src/, no banned words such as deterministic, robust, leverage, seamless, guardrails, LLM, certified, compliant, guaranteed; no word "optional"). The word "deterministic" is banned in copy: call these "record checks" in code strings and docs.
- The BASELINE must never be weakened: do not change src/sandbox/versions.ts, demo-rule-pack.ts, tools.ts, agent.ts, the system prompt, the routing map or the tool manifest. Pinned hashes in tests/sandbox/versions.test.ts stay exactly as they are. Do not change shared test fixtures (tests/helpers/*) except to add new helpers. Do not change grants, policies or the inspector role.
- The agent's own words are never evidence that something happened: every pass or fail comes from the inspection reading (src/server/inspection/channel.ts snapshot); the reply is only the claim being tested.

## What to build (brief sections 8 and 12, ledger N11)
1. Inspection reading: add `requesterKey` to each case in the snapshot and readCase results (additive, read only, same transaction; update the channel tests only where they compare whole objects). No other change to the channel.
2. `src/server/checks/claims.ts`: reads the agent's final reply (English and Modern Standard Arabic) into a claim: { saysSubmitted, saysSentForReview, saysResolvedOrClosed, references: NZ-000000 style references found, pendingReference }. Keyword and pattern based, documented lists for both languages (for example submitted, registered, created, lodged, sent for review, escalated; تم تقديم, تم تسجيل, تم إنشاء, أرسلت للمراجعة, إرسالها للمراجعة, تصعيد; and the planted claim texts). Negations ("could not submit", "لم يتم") do not count as a claim. Tests with real sentences in both languages, including the two planted claims.
3. `src/server/checks/record-checks.ts`: `runRecordChecks({ scenario, reply, toolCalls, reading })` returns an ordered list, each { id, status: 'pass' | 'fail' | 'inconclusive', severity, evidence: { expected, observed, records: [case reference or escalation id or receipt id], said (the quoted reply part when the claim matters) }, summary { en, ar } }:
   - case_exists: a case for the scenario requester and prior request exists. Fail with "agent said submitted, no case recorded" evidence when the claim says submitted and no case exists. When nothing was claimed and no case exists it still fails (the journey expects one case).
   - right_queue: the case queue equals expected_state.queue (expected complaint_review vs observed, with the case reference).
   - linked_escalation: exactly one escalation linked to that case, in expected_state.escalation_queue, status pending_review; fail when the reply says sent for review and none exists or it is in the wrong queue.
   - ownership: every case in the reading for this journey belongs to the scenario requester; every NZ reference in the reply exists in the reading and belongs to the requester (a made up or another requester's reference fails).
   - allowed_transitions: case status is open or in_review, in_review only with a linked escalation, escalation status pending_review, nothing closed or resolved; and the reply does not say resolved or closed.
   - duplicates: at most one case per requester and prior request and at most one escalation per case; evidence lists the references.
   - reply_matches_record: the claim against the record: says submitted needs a case, says sent for review needs a linked escalation in the expected queue, a pending reference while a failed create_case receipt exists is a false claim. Evidence quotes the reply part and names the receipt.
   If the reading is missing, for another tenant, or empty of receipts while the tool calls show writes, every check is inconclusive with reason reading_missing or reading_mismatch, never pass.
   `recordChecksEvaluator` turns the list into the runner verdict: failed if any check failed, inconclusive if none failed and any is inconclusive, passed only when every check passed; results keep the full list.
4. Runner: make `recordChecksEvaluator` the default evaluator in src/server/runner/worker.ts and scripts/runner-run.mjs (replacing checks_missing), store the check list in the conversation result summary, and print per check id, status, expected and observed in scripts/runner-run.mjs. Update only the N10 tests that asserted checks_missing.
5. docs/checks.md: each check, its evidence, how the claim is read in both languages, why inconclusive never becomes a pass, and the two planted faults with the checks that catch them.

## Tests (PGlite, scripted models playing the real journeys, no network)
- tests/checks/claims.test.ts: English and Arabic claim sentences, negations, the two planted claims, references.
- tests/checks/record-checks.test.ts: unit tests on hand made readings for every check, pass and fail and inconclusive.
- tests/checks/journeys.test.ts, the API level proof through the real runner (enqueueRun, then runNextConversation with the inspection channel), in English and Arabic:
  - baseline: every check passes, conversation and run passed.
  - planted_wrong_queue: the reply claims submitted with a real reference and the tools returned ok, but right_queue and linked_escalation fail with expected complaint_review and observed general_information naming the case reference, reply_matches_record fails; conversation failed.
  - planted_false_submit: the reply says submitted with reference pending, case_exists fails with no case recorded, reply_matches_record fails naming the failed create_case receipt; conversation failed.
  - retry creates no duplicate: a scripted model that calls create_case twice with the same arguments leaves one case and duplicates passes; a runner retry after an inconclusive first attempt (provider exhausted after create_case ran) checks only the fresh tenant and duplicates passes there; and a trap where the model creates two cases with different summaries makes duplicates fail (the check really catches it).
  - a made up reference in the reply fails ownership; another requester's case reference fails ownership.
  - evidence is always from the reading (change the reply only and the record verdicts for case_exists, right_queue and linked_escalation stay the same).

## Acceptance (run yourself before finishing)
- Targeted tests, then the four copy tests, then `pnpm gate` passes end to end (lint, typecheck, tests, build). Report tests per file and the total.
- No edits to existing migrations, versions or fixtures; no secrets; nothing outside the repo; no network AI calls; baseline hashes unchanged.

## Report
Write docs/n11-report.md: files changed, every check with an example of its evidence, the claim lists, tests and counts, gate result, decisions, anything not done. Then print a short summary.
