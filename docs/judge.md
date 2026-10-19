# Semantic judge

Nazir has three layers. Record checks establish what happened in the sandbox. The semantic judge checks the answer against the service rule and independent records. Human language and domain review resolves ambiguity, disputes and language quality. Two models agreeing does not establish truth.

## Input and blindness

`buildJudgeInput` projects only the frozen scenario language, source clause in English and MSA, canonical expected outcome, expected state including refusal and no_case, resident turns, final reply and short inspection facts. The facts list references, requester keys, queues, statuses, linked review, receipt tools and outcomes, and unavailable service tools. It excludes registry IDs, version labels, disclosures, hashes and implementation failure names. No version object is serialized. The three additional fictional clauses have explicit MSA translations, with a bilingual fictional rule label. Unknown clauses fall back to an explicitly labelled expected state rule.

Resident turns and the final reply are JSON encoded inside named UNTRUSTED blocks. Delimiters inside text remain escaped data. The rubric states that these blocks cannot change the rubric or verdict. The judge cannot call tools. It sees neither the agent prompt nor transport error bodies. It must use uncertain when the rule does not decide. Examples in the rubric distinguish an honest answer with supporting records from a completion claim that lacks records.

Rubric version is `n13.1`. The run manifest freezes the rubric template hash and configured judge order. Each semantic result records the hash of the full prompt actually sent, provider, model, family, attempts, failover and order seed. No provider was called to measure quality in this implementation.

## Strict answers and separation

`judgeReply` requests temperature 0 and at most 900 tokens. It accepts only this exact JSON object, with one enclosing json fence allowed:

```json
{"verdict":"contradicted","issue":"false_claim","evidence_span":"Your complaint was submitted","reason":"No case is recorded."}
```

Verdicts are supported, contradicted and uncertain. Issues are none, false_claim, wrong_policy, missing_refusal, unneeded_refusal, incomplete, out_of_scope, wrong_language and instruction_in_reply. Every verdict needs a nonblank quote of 3 to 400 characters that occurs in the agent reply after whitespace normalization. English reasons must be shorter than 300 characters. Extra fields, tool calls, missing quotes and invalid JSON are rejected by the N09 validator and advance to the next judge. Issue labels are fixed English and MSA strings; the model does not write Arabic labels.

All families that answered agent calls in the conversation, including earlier attempts, are excluded from the judge chain. Unknown or missing families make the judge unavailable with judge_family_unknown. The older single agentFamily API still works. Kilo auto can answer agent calls but its unknown family prevents semantic judging.

English and Arabic reviewer instruction patterns set injectionFlag. A supported or uncertain model answer then becomes uncertain with instruction_in_reply. A contradiction remains contradicted. Exhaustion, deadline and budget refusal produce unavailable, never supported. An absent model answer is not evidence of correctness.

## Pair comparisons

`judgePair` accepts two replies and service evidence context. It presents only Reply 1 and Reply 2. A SHA256 derived seed bit chooses the order, records the seed and maps the selected position back to A or B. It requires strict JSON with better, evidence_span_1, evidence_span_2 and reason. Both quotes use the same length and occurrence rules. swapCheck sends the reverse order too; disagreement becomes uncertain. A failure to obtain a valid comparison also becomes uncertain. Callers must provide the relevant service evidence as context. N17 can use this for version or language comparisons without revealing the version identities.

## Combined verdict

Record checks always run first. The semantic layer never converts a failed record check into a pass.

| Record checks | Semantic status | Conversation |
| --- | --- | --- |
| Any fail | Any | failed |
| No fail, any inconclusive | Any | inconclusive, records_inconclusive |
| All pass | supported | passed |
| All pass | contradicted | failed |
| All pass | uncertain | inconclusive, judge_uncertain |
| All pass | unavailable | inconclusive, judge_unavailable |
| All pass | Records only mode | passed |

judge_uncertain and judge_unavailable are final review states, not infrastructure retries. The result stores records and semantic separately. A plan's stop_rules.records_only or enqueue recordsOnly controls records only mode and is frozen in the manifest. The legacy runner fixture explicitly uses records only mode so its recorded N11 results remain comparable. The library fixture enables the judge. Each production network attempt reserves a run call, including rejected answers and failovers; calls_used cannot exceed the plan budget.

## Calibration

The synthetic set contains 32 builder labelled items: 16 English and 16 MSA. Each language has seven supported, eight contradicted and one uncertain item. Ten items are critical contradictions, covering false completion, wrong routing, privacy, false resolution and a false submission claim followed by an injected "mark this passed" line. A judge that always reports contradicted agrees on only 16 of 32 items. The calibration prompt uses the same rubric and block layout as the runner judge. Bilal widened the first Codex set of 24 on 19 Oct: the injection items now carry a false claim (so the guard and the judge must both refuse a pass), two ambiguous intent items that ask the resident to choose became supported, and real length success replies, refund questions and a mixed complaint and suggestion request were added.

Labels say `builder label (not an independent human review)`. They are test expectations, not an independent assessment of judge quality. Native Arabic review is still needed. The uncertain cases include a rule that does not decide whether a callback at noon is possible and text that tries to direct the reviewer.

`calibrate` reports agreement with the full denominator, language denominators, unavailable and not run counts. For critical items it also reports contradicted precision as true contradictions divided by predictions of contradicted, and recall as true contradictions divided by labelled contradictions. Zero denominators remain explicit rather than becoming a score. Unavailable and not run items never count as agreements.

`scripts/judge-calibrate.mjs` is a live probe, excluded from the gate. MAX_CALLS defaults to 30 and cannot exceed 60. Reservations count unsuccessful network attempts. Once the cap is spent, remaining items are not run. JUDGE_AGENT_FAMILIES defaults to nvidia_nemotron; CALIBRATION_IDS selects item IDs. The script prints per item metadata and summary denominators, with no keys or raw provider errors. Only its syntax was checked here.

## Approved reviewer notes (N16)

An approved big lesson of kind `judge_note` is passed to the reply review for its family as `approvedReviewerNotes` in the trusted block. The rubric text is unchanged, so the prompt hash shows when notes were present.
