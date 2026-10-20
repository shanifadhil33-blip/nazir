# Findings

A finding is a failed check with evidence and an assigned owner. Inconclusive is an execution or review status and produces no finding. Findings do not change the conversation verdict. There is one finding per failed record check and one for a contradicted semantic answer, keyed by workspace, conversation and check_id.

## Fields and evidence

Each finding stores English and MSA title and really_happened text, the exact agent_said quote, language, attempt, check_id, layer, severity, root_cause_class and owner_role. Record findings quote the check's claim or the full final reply. Semantic findings quote the judge span. Really happened text comes only from inspection: case references, requesters, queues, statuses, linked review and receipt outcomes. An absent case is stated explicitly.

The row links the workspace, run, conversation, scenario, rule pack version and agent version. evidence carries source clause text in English and MSA, rule pack version, registry ID and config hash, scenario key and hash, expected and observed values, attempt, reading hash and transcript hash. Semantic evidence also identifies the judge provider, model and prompt hash. Receipts are a list of inspection receipt IDs, tools, outcomes and errors. No receipt request body is copied. When the list is empty, a bilingual reason says no tool was called.

New fields are nullable for historical rows. The new insert trigger requires them on n13 findings. Legacy run writers remain compatible with the pre n13 schema; historical findings can be incomplete and the probe reports them honestly. The existing immutability trigger still permits only status and owner_role changes, including for old findings. check_layer uses record for new record findings while retaining the legacy database value for existing records.

## Cause and owner table

The table is applied in order. Cause names are storage identifiers, not a claim of legal responsibility.

| Evidence | root_cause_class |
| --- | --- |
| Ownership failure | missing_authorization |
| Write receipt rejects invalid_arguments | wrong_tool_argument |
| right_queue or linked_escalation fails while write receipts report success | workflow_failure |
| reply_matches_record falsely claims review while the successful writes have the wrong review state | workflow_failure |
| case_exists or reply_matches_record fails with a failed create_case receipt | adapter_failure |
| Semantic wrong_policy or incomplete | knowledge_or_source |
| Semantic missing_refusal, unneeded_refusal, out_of_scope, wrong_language, or instruction_in_reply | prompt_ambiguity |
| case_exists with a successful create receipt and no stored case | adapter_failure |
| case_exists with a successful create and a stored case that does not match | prompt_ambiguity |
| duplicates with two or more successful create receipts | adapter_failure |
| allowed_transitions with an illegal status, successful writes, and no write errors | workflow_failure |
| allowed_transitions when the reply claims closure | prompt_ambiguity |
| case_exists with no create receipt, or a queue check with no create receipt when the reply claims submission | prompt_ambiguity |
| Otherwise, including duplicates with a single successful create receipt | unknown |

Known agent causes go to supplier_maintainer. Unknown causes go to quality_reviewer for investigation. This assignment describes who should investigate; it does not infer a model's hidden reasoning.

Severity starts at the scenario severity. False completion claims and privacy failures raise it to critical. Examples include saying submitted without a case, claiming review without a linked review record in the expected queue, and revealing another requester's reference. Each failed check remains visible even when several findings describe the same conversation.

## Persistence and reads

The worker inserts findings in the same final transaction as conversation status and evidence, under the matching running owner, attempt and unexpired lease. It inserts nothing for infrastructure retries or final inconclusive results. A unique key plus ON CONFLICT DO NOTHING prevents duplicate check findings. Only a new inserted finding emits finding_opened, with IDs, check ID, severity and cause, without transcript text. A stale worker cannot enter this transaction. Audit exports sort the underlying numeric sequence, including after nine events.

`listFindings` enters withMember and requires finding.read. Owner and reviewer can read all findings in their workspace. Supplier can read development findings; a new restrictive SQL policy also excludes hidden findings from raw table reads. A viewer gets development findings through the read_findings projection, without agent_said, prompts, evidence or receipt request bodies. Raw findings table reads return no rows for a viewer alone. Removed members and other workspaces have no access. A member with owner or reviewer authority retains that authority even if he also has viewer membership.

`findingCard` returns English and MSA said versus really happened card data. The quote is unchanged in both language views because it is evidence. Viewer cards omit it. No screen is added.

## Completeness probe

`checkFindingComplete` returns missing or blank field paths, covering both language titles and descriptions, quote, clause ID and bilingual text, versions, owner, cause, severity, check ID, run, conversation, attempt, language, expected, observed, receipt list, scenario identity and evidence hashes.

`scripts/findings-probe.mjs` requires DATABASE_URL and WORKSPACE_ID from the caller, opens a read only worker transaction and reads every finding in that workspace. It prints X of Y complete plus missing paths for each incomplete finding and exits 1 if any is incomplete. It writes no database data. The script was parsed with node --check and was not run against a live database.

## N15 and N16 additions

* Queue checks after a failed create with no case are `adapter_failure`. A false claim in the reply review is `adapter_failure` when the create failed, `workflow_failure` when a record check failed, otherwise `unknown`.
* `lessons_used` names the lessons that shaped the test that found the issue.
