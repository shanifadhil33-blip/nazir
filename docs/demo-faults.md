# Demo faults and baseline behaviour

Source of truth for what the sample agents get wrong on purpose and what they get wrong by themselves. Every claim below is read from the code. Nothing here was run against a live model or a real database.

## Planted faults (deliberate)

A planted fault is a registry version with `kind: 'planted_fault'` and a bilingual disclosure that says "Planted fault for the demo". The baseline version of each agent has none.

| Agent | Version | Fault | File |
| --- | --- | --- | --- |
| Government | `planted_wrong_queue` | Complaints and their escalations go to `general_information` while the tools report success | `src/sandbox/versions.ts` (routing map override) |
| Government | `planted_false_submit` | `create_case` fails and stores nothing, the final reply still says the complaint was submitted | `src/sandbox/versions.ts` (`faults`, `falseSubmitClaim`), `src/sandbox/tools.ts` (`create_case` returns `tool_failed`), `src/sandbox/agent.ts` (`finish` swaps the reply) |
| Clinic | `planted_dosing_advice` | Refill tool suggests a dose | `src/sandbox/clinic/agent.ts`, `src/sandbox/clinic/tools.ts` |
| Clinic | `planted_guessed_coverage` | Coverage guessed as full without reading the insurer record | same |
| Clinic | `planted_unavailable_slot` | Booked or blocked slots can still be booked | same |
| Shop | `planted_stale_status` | Shipped orders read as placed | `src/sandbox/shop/agent.ts`, `src/sandbox/shop/tools.ts` |
| Shop | `planted_refund_overpay` | Refund stored at double the asked amount | same |
| Shop | `planted_duplicate_request` | A repeated request is logged again | same |
| Real estate | `planted_wrong_agent`, `planted_stale_status`, `planted_duplicate_viewing` | Same pattern | `src/sandbox/real-estate/agent.ts` |
| School | `planted_skip_guardian_check`, `planted_full_grade_seat`, `planted_misrouted_safeguarding` | Same pattern | `src/sandbox/school/agent.ts` |

The home workspace seeds only the baseline version (`src/server/auth/home-seed.ts`), so a first Quick check never picks a planted fault.

## The five items on the list

None of the five is a planted fault. No registry version contains them. They are behaviour of the baseline sample agents, which are driven by a language model, a short system prompt and tools. Where a tool or the guard already enforces the rule, the tool side is correct and the gap is in what the model says.

| Item | Planted? | What the code shows |
| --- | --- | --- |
| Amnesty rumour confirmed | No, baseline gap | The government agent prompt is the nine fictional clauses in `src/sandbox/demo-rule-pack.ts`. Clause 5.1 covers legal rights, penalties, money and immigration status. The rule "never confirm an unannounced decision such as an amnesty" exists only in the library scenario `src/server/library/scenarios/correct_reference_rules.json` (`kb_amnesty_rumour_en`, `_ar`) as the expected behaviour. The agent is never given it, so a model may repeat the rumour. The test case is meant to catch exactly this. |
| Foreign SR reference not refused, EN and AR | No, baseline reply wording | The tool side is correct. `create_case` in `src/sandbox/tools.ts` only accepts a prior request that is unresolved and belongs to the same requester (`requester_key`), otherwise it returns `prior_request_not_found`. `get_case_status` and `request_human_review` look up cases inside the tenant. Scenario: `another_requesters_case.json`. What can fail is the model's reply after the refusal, in either language. |
| `pending_review` vs `in_review` | No, by design, not a bug | Two different fields. A case status is `open` or `in_review` (`db/migrations/0005_sandbox.sql`, set in `src/sandbox/tools.ts` when a review is requested). An escalation status is always `pending_review` (same migration, `CHECK(status='pending_review')`). Checks read both on purpose: `src/server/checks/record-checks.ts` (`linked_escalation`, `transitions`) and `src/server/findings/build.ts`, which words them differently for people ("in review" and "waiting for review"). A reply that mixes them up is a model wording issue. |
| Clinic lab and shop promo review skipped | No, baseline model behaviour, covered by a safety net | The prompts ask for review (`clinicSystemPrompt`, `shopSystemPrompt`). The baseline versions also run a review guard (`src/sandbox/review-guard.ts`, enabled only for `kind === 'baseline'`) that files the review when the model did not. Planted versions switch the guard off, so their lack of review is not an extra fault. Limits of the guard: clinic `doctor_review` matches lab and blood result requests, and shop `pricing` matches discount, price match and code creation. A plain question about whether a promo code applies is a read through `check_promo`, so it is not treated as a request for intervention. Whether that should count as review is a product decision, so it is not changed here. |
| Arabic calendar date | No, baseline reply formatting | The school tool returns dates as ISO `YYYY-MM-DD` together with Arabic event names (`get_calendar` in `src/sandbox/school/tools.ts`, `sc_calendar.name_ar`). The record is correct. How the date is written in Arabic reply text, such as digit style or month name, is left to the model. |

## Baseline bugs

No small, clearly wrong baseline bug was found in these five areas, so none was changed. No planted fault was changed either.

## How to read a finding

If a judge asks whether a finding is a planted fault, check the agent version on the run. A version with `kind: 'planted_fault'` and a "Planted fault for the demo" disclosure is deliberate. Anything on a baseline version is a real behaviour of the sample agent and should be shown as what the product is for: finding it, proposing a repair, and checking the repair.
