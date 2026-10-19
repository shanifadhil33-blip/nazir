# Test library

The library is original fictional service test data, with invented male requesters Saeed Al Hashimi and Imran Qureshi from the sandbox seed. It contains 12 families, 24 canonical meanings and 48 scenarios. Each family has one normal successful meaning and one trap; each meaning has English and Modern Standard Arabic twins. All expectations are labelled `fictional_demo_rule`. No public benchmark text is copied.

| Group | Family | Split | Meanings | Scenarios |
| --- | --- | --- | ---: | ---: |
| Approved information | correct_reference_rules | development | 2 | 4 |
| Approved information | missing_required_details | development | 2 | 4 |
| Complaint intent | complaint_vs_suggestion | development | 2 | 4 |
| Complaint intent | unresolved_prior_request | development | 2 | 4 |
| Transaction truth | success_without_case | development | 2 | 4 |
| Transaction truth | wrong_routing_queue | hidden | 2 | 4 |
| Case lifecycle | open_case_described_resolved | development | 2 | 4 |
| Case lifecycle | repeated_request_duplicates | hidden | 2 | 4 |
| Privacy and authority | another_requesters_case | development | 2 | 4 |
| Privacy and authority | broad_case_export | hidden | 2 | 4 |
| Language and inclusion | english_msa_equivalent | development | 2 | 4 |
| Language and inclusion | mixed_names_and_numerals | hidden | 2 | 4 |

Eight development families contain 32 scenarios. Four hidden families contain 16 scenarios. Supplier maintainers and viewers cannot read hidden scenarios through either the server functions or existing database policies. A viewer has no scenario access. Hidden access requires owner or reviewer authority. Adding viewer to an authorized role does not remove that role's authority.

## Canonical meanings and hashes

One meaning describes an intent and expected outcome relative to its requester. Its two scenarios express that meaning naturally rather than as literal translations. The existing complaint pair is retained exactly: Saeed uses SR-1042 in English and Imran uses SR-2077 in Arabic. The projected runner inputs and their hashes are tested against the unchanged demo definitions.

`loadLibrary()` reads and validates every JSON file using strict Zod objects, then computes SHA256 over recursively sorted JSON with array order preserved. Each scenario hash covers its complete source scenario; each meaning hash covers its canonical record and both twins. A whole-library digest pins the current source content in tests. Database `content_hash` retains the existing PostgreSQL JSONB format; `library_hash` stores the source scenario digest. These are separate formats with separate purposes.

## Imports, approval and regression

Call `importLibrary(driver, memberId, await loadLibrary(), source)` from trusted backend code. The member identity comes from `requireMember`. Import enters `withMember`, requires `scenario.write`, and writes an audit event in the same transaction. Unchanged imports reuse their versions. Changed meaning content receives a new meaning record, and changed versions are inserted as drafts. Resident turns are also copied into persona for the existing runner input shape. Starting state describes sandbox seeds, existing cases and controlled tool failures; it is test fixture data, never a real service connection.

`approveScenario` requires `scenario.approve` and a different human from the author, following N05. Approval stamps the actor and time and records an audit event. Existing database triggers freeze every approved scenario content field; an added trigger also freezes its meaning. Changes require new draft versions and another approval. Source `generated` always imports as draft. `regressionSuite` returns approved rows only, including generated rows only after human approval. It requires the authority to read both splits.

The library records applicable N11 check IDs, not a claim that record checks can judge every policy answer. N11's default evaluator remains the complaint journey evaluator. Information accuracy, refusal wording and cross-language meaning need semantic or human review; the library supplies the expected outcome and source for that review. The current runner does not automatically prepare the new existing-case or failed-tool fixtures from starting state. Tests validate the library, import and authorization lifecycle, not live model quality across all 48 cases.

## Twin exposure rule

Split is assigned by family, never by language. Validation refuses mixed splits or missing language twins. `markUsedForFix` records exposure on the meaning with an audited write. Reading scenarios returns `unseen=false` for both twins and all versions sharing that workspace's `meaning_key`, even when a later version has a different canonical hash. Exposure is stored separately so marking use cannot modify frozen scenario content. Hidden is an access category; unseen is an exposure claim. A used hidden case stays protected by hidden access rules while losing its unseen claim.

## Adding a case

Add a meaning with a stable `meaning_key`, normal or trap kind, an intent and expected outcome, and exactly one English and one Arabic scenario. Use only the sandbox requester keys. Keep the same family split for both twins. Include the persona, resident turns, complete starting state, tool allow and deny lists, expected state, applicable record check IDs, severity and rubric version. Use an existing demo clause ID or a source beginning `fictional demo rule: ` with the expectation kind `fictional_demo_rule`.

Run schema and import tests, review both languages, and update the pinned library digest after checking the content diff. Import the new versions as drafts, then have another authorized human approve each scenario before using it in regression. Never edit an approved database record to improve a result.

## Review still required

Reviewed Gulf phrasing is excluded from these 12 families and is waiting for a native reviewer. The original MSA copy has not received independent native review either; no reviewed-language or fairness claim is made. Eastern Arabic digits and mixed-script names are exercised in Arabic; the English twins preserve the same supplied normalized identifier without Arabic script. All data is synthetic. No live AI or Google calls are needed for validation.
