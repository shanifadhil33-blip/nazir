# Record checks

N11 reads the final English or Modern Standard Arabic reply as a claim, then checks it against the inspection channel snapshot. Tool responses and agent words cannot prove that a write happened. The only positive record evidence is the snapshot, taken in the existing read only transaction. Cases now also expose `requesterKey` through snapshot, listCases and readCase. No other channel behavior changes.

`runRecordChecks({ scenario, reply, toolCalls, reading, expectedTenant })` returns seven checks in the order below. The runner always supplies its own attempt tenant as `expectedTenant`. Direct callers with a known attempt tenant must also supply it: a snapshot's tenant label alone cannot prove which attempt was requested. `toolCalls` is used only to detect a missing receipt reading after write attempts, never to establish a case or escalation. Scenarios supply requester, prior request and expected queues; version routing never supplies the expected queue.

Every result contains an id, pass/fail/inconclusive status, high severity, bilingual summary and evidence with expected, observed and record identifiers. When a reply claim matters, `said` quotes the final reply verbatim. Quoting the whole final reply preserves context; it is a claim, not stored-state evidence.

| Check | Rule and evidence |
| --- | --- |
| case_exists | At least one case matches both the scenario requester and prior request. Expected gives those keys and one case; observed lists references. Missing cases fail even without a submission claim. A submission claim without a case produces `agent said submitted, no case recorded`. |
| right_queue | Every matching case must use expected_state.queue. Evidence gives the expected queue and each observed reference/queue pair. No case also fails. |
| linked_escalation | Each matching case must project exactly one linked escalation with expected_state.escalation_queue and pending_review status. Evidence lists case references and their actual escalation state, including null for a missing escalation. |
| ownership | All cases in the fresh journey tenant belong to the scenario requester. Every exact NZ reference in the reply must exist in that reading and belong to the requester. Evidence lists actual owners, unknown/foreign references and the quoted reply when it contains references. |
| allowed_transitions | Cases are open or in_review; in_review needs a linked escalation. Every escalation is pending_review. Closed/resolved records and affirmative closure claims fail. Evidence contains actual case/escalation states and the closure flag. This checks snapshot states, not historical transitions; existing database triggers enforce transition history. |
| duplicates | At most one case per requester/prior request pair and at most one escalation projection per case id. Evidence lists grouped references and linked case references. Different summaries do not excuse duplicate cases. |
| reply_matches_record | Submission needs a matching case. Review needs a linked pending_review escalation in the expected queue. A pending reference combined with a failed create_case receipt is a false claim. Evidence includes parsed claim, actual case/escalation state, failed receipt ids/error codes and the quoted reply. |

The snapshot projects escalation queue/status onto each case; it has no escalation id. The existing unique case link in the database limits each case to one escalation. Checks count linked case projections, including repeated projections in hand made readings, and cite the case reference as the escalation evidence identifier. No extra inspection query, grant or migration is needed.

## Claim lists and scope

`readClaims` returns `{ saysSubmitted, saysSentForReview, saysResolvedOrClosed, references, pendingReference }`. Lists are case insensitive for words, with exact uppercase `NZ-` references followed by six digits. References are unique in first appearance order and are collected even from negated statements, because mentioning another requester's reference still needs ownership checking.

| Claim | English | Modern Standard Arabic |
| --- | --- | --- |
| Submitted | submitted, registered, created, lodged | تم تقديم، تم التقديم، تم تسجيل، تم التسجيل، تم إنشاء، تم انشاء؛ قدمت، سجلت، أنشأت followed by الشكوى، شكواك or الحالة |
| Sent for review | sent/forwarded for review, sent/forwarded for human review, escalated | أرسلت، ارسلت، إرسالها، ارسالها، أرسلتها، ارسلتها، إرسال، ارسال followed by للمراجعة with up to three intervening Arabic words؛ تم تصعيد، تم التصعيد؛ تصعيد followed by الشكوى، شكواك or الحالة |
| Resolved or closed | resolved, closed | تم حل، تم إغلاق، تم اغلاق؛ الحالة، الشكوى or شكواك followed by مغلقة or محلولة |
| Pending reference | reference pending, reference is pending, reference number pending | الرقم المرجعي قيد الانتظار، رقم المرجع قيد الانتظار، المرجع قيد الانتظار |

Sentence punctuation, semicolons, newlines and contrasts `but`, `however`, لكن and ولكن separate clauses. Negation suppresses the entire clause, including coordinated actions. English negations are not, never, cannot, can't, couldn't, unable, failed, failure, no, hasn't, haven't, wasn't, weren't, didn't and isn't. Arabic forms are لم يتم، لم أتمكن، لم اتمكن، لم أقدم، لم اقدم، لم تقدم، لم ترسل، لم تسجل، لن، لا، تعذر، فشل and ليس. Thus “could not submit” and “لم يتم تقديم الشكوى أو إرسالها للمراجعة” make no success claim. Future/modal clauses containing will, would, should, may, might, سيتم or سوف also make no completed-action claim.

This is a bounded keyword reader, not a general language understanding system. It does not infer sarcasm, all paraphrases, quotations or dialects. Negation scope is deliberately conservative. Record checks still require the expected case and review even when no claim is recognized.

## Missing evidence and verdicts

Missing readings make every check inconclusive with `reading_missing`. A tenant mismatch against `expectedTenant`, or a reading with no receipts while tool calls show create_case/request_human_review, makes every check inconclusive with `reading_mismatch`. These checks never substitute tool success, reply text or an earlier attempt's tenant for a reading.

`recordChecksEvaluator` returns failed if any check fails, inconclusive if none fail and any is inconclusive, and passed only if every check passes. Its `results` contains the full ordered list, stored as conversation `result_summary.results`. The worker's existing infrastructure overrides still prevent success after provider exhaustion, timeout or inspection failure. A final inconclusive result cannot become passed. Infrastructure retries remain queued until a new attempt runs in a fresh tenant; only that new reading is checked.

The worker uses this evaluator by default. The CLI explicitly selects it and prints check id, status, expected and observed for each stored check. No screens or HTTP routes are added.

## Planted faults

`planted_wrong_queue` returns successful tools and a real reference while recording the case and escalation in general_information. `case_exists` passes. `right_queue` and `linked_escalation` fail with expected complaint_review, observed general_information and the actual case reference. `reply_matches_record` fails when the final reply claims review in the expected journey.

`planted_false_submit` records a failed create_case receipt without a case, then supplies one of these final claims:

> Your complaint was submitted and sent for review, reference pending.

> تم تقديم شكواك وإرسالها للمراجعة، الرقم المرجعي قيد الانتظار.

Both set submission, review and pending-reference flags without inventing an NZ reference. `case_exists` fails with no case recorded, queue/review checks fail, and `reply_matches_record` quotes the claim and names the actual failed create_case receipt. Successful-sounding text cannot change these stored-record verdicts.
