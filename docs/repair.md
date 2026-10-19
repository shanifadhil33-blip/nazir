# Repairs (N15)

A repair is a small, listed change to the service agent that a supplier proposes and a reviewer decides.

## Who does what
* The supplier maintainer proposes (`submitRepair`). Nazir can draft one too (`draftRepairByNazir`), but a person still decides.
* The quality reviewer or service owner decides (`decideRepair`) with a reason of at least 10 characters. Nobody decides his own proposal, and the database checks this again (`b_proposal_required` in 0014).
* Reject keeps everything as it was. Approve creates a new frozen agent version of kind `repair`.

## What a repair may change
Only the allowlist in `src/server/repair/executable.ts`: `restore_routing{category}`, `remove_create_case_fault`, `remove_false_submit_claim`. One to five ops, no duplicates, and every op must change the parent. A cause that needs a server side change (for example missing authorization) gets no patch and the line "This cause needs a server side change, not a prompt change." in English and Arabic.

## After approval
`repair_materialize` (worker only, SECURITY DEFINER) writes the frozen version and two approved plans:
* Retest: the affected cases (same meaning, EN and AR), normal cases of the same family, retry cases (`repeated_request_duplicates`) and unseen hidden cases of the related hidden family.
* Frozen regression suite: every approved scenario, one per stable key and language, library rows first.

`startRetest` runs them in that order. Hidden cases are shown to the supplier only as a count. Each used hidden meaning is recorded in `library_fix_usage` so it is not used to judge the same fix twice.

## Old records
Approving and retesting never touch the old run. `evidenceDigest` hashes the run, conversations, messages, tool events, readings and findings (without status fields that a reviewer may change). The live check prints `OLD_RECORDS SAME` when the digest before and after match.

Live check: `scripts/repair-cycle.mjs` (MAX_CALLS default 40, hard limit 80; RUN_SET retest, suite or both; RECORDS_ONLY).
