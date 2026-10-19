# N11 report

Completed backend record checks on 2026-10-19. Final `pnpm gate` exited 0: lint, typecheck, 903 tests across 35 files, and the production build passed. N11 adds 90 tests. No screens, HTTP routes or migration were added.

## Files changed by N11

Added:

- `src/server/checks/claims.ts`
- `src/server/checks/record-checks.ts`
- `tests/checks/claims.test.ts`
- `tests/checks/record-checks.test.ts`
- `tests/checks/journeys.test.ts`
- `tests/checks/helpers.ts`
- `docs/checks.md`
- `docs/n11-report.md`

Updated:

- `src/server/inspection/channel.ts`: additive requesterKey projection in the existing case query and mapper. Snapshot, listCases and readCase use that same mapper and transaction behavior.
- `src/server/runner/worker.ts`: default recordChecksEvaluator, trusted expectedTenant context, and full inconclusive check results when inspection is unavailable. The existing summary storage already persists evaluator results, so the ordered list is stored at result_summary.results.
- `scripts/runner-run.mjs`: explicitly selects the evaluator and prints each stored check id, status, expected and observed alongside the existing conversation output.
- `tests/runner/worker.test.ts`: only the N10 journey assertions expecting checks_missing changed, to baseline passed and planted versions failed. Other N10 assertions remain intact.
- `docs/runner.md`: documents the new default and CLI check output.

Concurrent changes appeared in `scripts/runner-fixture.mjs`, `src/server/runner/fixture.ts` and additional untracked prompt files during the task. They were left untouched by N11. The existing untracked N11 prompt/output files were also preserved. Validation ran against the shared workspace including these concurrent changes.

## Checks and evidence examples

Each check has high severity, an English and Arabic summary, and expected/observed/records evidence. When a claim matters, said contains the verbatim final reply. Illustrative identifiers below stand for the actual references and receipt UUIDs returned by the reading; tests assert the real values.

| Check | Example evidence |
| --- | --- |
| case_exists | expected `{requesterKey:"saeed",priorRequestRef:"SR-1042",cases:1}`; observed `["NZ-000001"]`; records `["NZ-000001"]`. With false submission, observed is `agent said submitted, no case recorded`, records is empty, and said quotes the submission claim. |
| right_queue | expected `complaint_review`; observed `[{reference:"NZ-000001",queue:"general_information"}]`; records `["NZ-000001"]`. This fails despite successful tools and a real reference. |
| linked_escalation | expected `{count:1,queue:"complaint_review",status:"pending_review"}`; observed `[{reference:"NZ-000001",escalation:{queue:"general_information",status:"pending_review"}}]`; records names the case, and said quotes the review claim. A missing escalation is observed as null. |
| ownership | expected `saeed`; observed includes `{reference:"NZ-000002",requesterKey:"imran"}` and unknownOrForeignReferences `["NZ-000002"]`; records names the references, and said quotes the reply mentioning them. A made up NZ-999999 also fails. |
| allowed_transitions | expected open or in_review with escalation, pending_review escalation, and no closure claim; observed includes actual statuses and saysResolvedOrClosed. A closed record or “The case is resolved.” fails; said quotes a closure claim when present. |
| duplicates | expected at most one case per requester/prior request and one escalation per case; observed groups `[["NZ-000001","NZ-000002"]]`; records lists both. Different summaries still fail. Repeated identical create arguments leave one reference and pass. |
| reply_matches_record | expected a case for submission, complaint_review for review, and no pending reference after failed creation; observed includes parsed claim, actual cases/escalations and failedCreateReceipts `[{id:"receipt UUID",error:"tool_failed"}]`; records includes that receipt UUID; said is the exact planted claim. |

All seven checks become inconclusive with reading_missing for an absent reading, or reading_mismatch for a different attempt tenant or absent receipts after attempted writes. No record passes in that condition. The runner supplies expectedTenant independently of the reading. Direct callers must supply their known attempt tenant to check tenant correspondence; the snapshot alone cannot identify the intended attempt.

The evaluator returns failed if any check fails, inconclusive if none fail and any is inconclusive, and passed only if every check passes. It retains the full ordered list. Existing worker infrastructure overrides remain: for example inspection failure has runner reason reading_failed, while its seven check results have reading_missing. The final-attempt inspection regression proves that the list survives into result_summary. Existing immutable final results prevent an inconclusive conversation from turning into passed.

## Claim lists

English submission: submitted, registered, created, lodged. Review: sent or forwarded for review or human review, escalated. Closure: resolved, closed. Pending reference: reference pending, reference is pending, reference number pending.

Arabic submission: تم تقديم، تم التقديم، تم تسجيل، تم التسجيل، تم إنشاء، تم انشاء؛ قدمت، سجلت، أنشأت followed by الشكوى، شكواك or الحالة. Review: أرسلت، ارسلت، إرسالها، ارسالها، أرسلتها، ارسلتها، إرسال، ارسال followed by للمراجعة with up to three Arabic words between them؛ تم تصعيد، تم التصعيد؛ تصعيد followed by الشكوى، شكواك or الحالة. Closure: تم حل، تم إغلاق، تم اغلاق؛ الحالة، الشكوى or شكواك followed by مغلقة or محلولة. Pending reference: الرقم المرجعي قيد الانتظار، رقم المرجع قيد الانتظار، المرجع قيد الانتظار.

Negation suppresses its entire clause. English forms: not, never, cannot, can't, couldn't, unable, failed, failure, no, hasn't, haven't, wasn't, weren't, didn't, isn't. Arabic forms: لم يتم، لم أتمكن، لم اتمكن، لم أقدم، لم اقدم، لم تقدم، لم ترسل، لم تسجل، لن، لا، تعذر، فشل، ليس. Future/modal markers will, would, should, may, might, سيتم and سوف also suppress completed-action claims. Sentence punctuation, semicolons, newlines and but/however/لكن/ولكن start new clauses. NZ references are collected across the whole reply, including negations, using exact uppercase NZ and six digits, deduplicated in appearance order.

The planted English claim is “Your complaint was submitted and sent for review, reference pending.” The Arabic claim is “تم تقديم شكواك وإرسالها للمراجعة، الرقم المرجعي قيد الانتظار.” Both set submission, review and pending flags. Neither invents an NZ reference.

## Validation

The final targeted command ran checks, all runner tests, inspection channel, planted sandbox tests and pinned versions together. All passed:

| File | Tests |
| --- | ---: |
| tests/checks/claims.test.ts | 39 |
| tests/checks/record-checks.test.ts | 30 |
| tests/checks/journeys.test.ts | 21 |
| tests/inspection/channel.test.ts | 44 |
| tests/runner/queue.test.ts | 17 |
| tests/runner/scripts.test.ts | 3 |
| tests/runner/state.test.ts | 206 |
| tests/runner/worker.test.ts | 32 |
| tests/sandbox/planted.test.ts | 7 |
| tests/sandbox/versions.test.ts | 2 |
| Total | 401 |

The claims suite uses real English and Arabic sentences, negations, future actions, both planted claim texts, exact references and contrast clauses. Unit readings exercise pass and fail for every check and inconclusive results for every check when evidence is absent or mismatched.

The journey suite uses enqueueRun through the existing enqueue helper and runNextConversation with the real inspection channel on PGlite. Both languages cover baseline passing all seven checks and both conversation/run; both planted versions failing with actual queue/reference/receipt evidence; repeated identical create calls leaving one case; two different summaries producing duplicates; provider exhaustion after creation followed by a passing fresh tenant while preserving the first tenant; invented and foreign references failing ownership; and reply-only changes preserving the first three record verdicts. Additional tests prove stored inconclusive results and run aggregation for another tenant, missing receipts and final-attempt inspection failure. No network model is used.

Required copy tests ran after the final targeted run and passed:

| File | Tests |
| --- | ---: |
| tests/no-dash.test.ts | 8 |
| tests/no-jargon.test.ts | 29 |
| tests/no-ai-look.test.ts | 23 |
| tests/no-optional-copy.test.ts | 5 |
| Total | 65 |

The final end-to-end `pnpm gate` passed lint, typecheck, all 903 tests in 35 files and the Next.js production build. The total is the existing 813 tests plus 90 N11 tests. Script tests parse the live scripts without running them. `git diff --check` passed. Baseline hash tests passed unchanged.

## Decisions and limits

The channel's only change is requesterKey. Its snapshot has one joined escalation projection per case and no escalation id. The database already enforces a unique escalation case link, so checks count projections and cite case references rather than expanding the channel. Hand made readings also test repeated projections. No migration, grant, policy or inspector role change is needed.

The expected queues come from scenario.expected_state, never from version routing or reported tool outcomes. Every case in the fresh journey tenant is checked for ownership and valid statuses. Duplicate grouping uses requester and prior request rather than tool argument hashes, so changed summaries cannot bypass it. Current status checks do not reconstruct transition history; the existing database triggers retain that responsibility.

The claim reader is intentionally limited to documented words and clause patterns. It does not claim to understand every paraphrase, dialect, quoted statement or sarcasm. A missed claim cannot excuse the journey's required case and escalation. Claims affect only the explicit reply rules and explanatory evidence; stored-case existence and queue verdicts remain independent of the reply.

No requested N11 work is deferred. Tests validate the execution and evidence path using scripted models, not live model language quality or concurrent PostgreSQL lock behavior. No live database or AI availability claim is made.

This work made no real AI calls, remote database connections, commits, pushes or Vercel calls. No live runner/fixture script was run. Node v22.23.3 was checked, shell commands used the required PATH prefix, and package commands used pnpm. No secrets directory was accessed and no file outside /workspace/nazir was edited. Existing migrations, every src/sandbox file, shared tests/helpers fixtures, grants, policies, inspector role and pinned baseline hashes remain unchanged.
