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

The library records applicable N11 check IDs, not a claim that record checks can judge every policy answer. N11's default evaluator remains the complaint journey evaluator. Information accuracy, refusal wording and cross-language meaning need semantic or human review; the library supplies the expected outcome and source for that review. The n13 runner prepares existing cases and service tool failures from the frozen starting state. PGlite journeys exercise these paths with scripted agents and fake judges, without measuring live model quality across all 48 cases.

## Twin exposure rule

Split is assigned by family, never by language. Validation refuses mixed splits or missing language twins. `markUsedForFix` records exposure on the meaning with an audited write. Reading scenarios returns `unseen=false` for both twins and all versions sharing that workspace's `meaning_key`, even when a later version has a different canonical hash. Exposure is stored separately so marking use cannot modify frozen scenario content. Hidden is an access category; unseen is an exposure claim. A used hidden case stays protected by hidden access rules while losing its unseen claim.

## Adding a case

Add a meaning with a stable `meaning_key`, normal or trap kind, an intent and expected outcome, and exactly one English and one Arabic scenario. Use only the sandbox requester keys. Keep the same family split for both twins. Include the persona, resident turns, complete starting state, tool allow and deny lists, expected state, applicable record check IDs, severity and rubric version. Use an existing demo clause ID or a source beginning `fictional demo rule: ` with the expectation kind `fictional_demo_rule`.

Run schema and import tests, review both languages, and update the pinned library digest after checking the content diff. Import the new versions as drafts, then have another authorized human approve each scenario before using it in regression. Never edit an approved database record to improve a result.

## Review still required

Reviewed Gulf phrasing is excluded from these 12 families and is waiting for a native reviewer. The original MSA copy has not received independent native review either; no reviewed-language or fairness claim is made. Eastern Arabic digits and mixed-script names are exercised in Arabic; the English twins preserve the same supplied normalized identifier without Arabic script. All data is synthetic. No live AI or Google calls are needed for validation.

## Fixture preparation

`scripts/runner-library-fixture.mjs` prepares Nazir library fixture, with invented male author Omar Mansoor and reviewer Khalid Hamdan. It bootstraps the workspace through the worker login when needed, then prepares the registry, adapter, rules and the second member in an owner transaction, imports and approves through the app login with the real member checks (the hosted owner role cannot take the nazir_app role), and finishes the approved plan with an 80 call budget in a second owner transaction. Tests use createLibraryFixture, the same steps in one local transaction. Replaying the helper changes no rows or audit events. It prints workspaceId, planId, registry version row IDs and the 48 scenario IDs indexed by stable_key. The two legacy complaint scenarios are also retained in this workspace by the shared administration fixture helper.

The worker calls seed_tenant then seed_tenant_state with the database scenario starting_state. The latter accepts only sandbox, up to ten strictly shaped cases and a tool_failure value of none or create_case. It refuses existing cases, receipts and failure settings. Seed references advance the shared sequence under a case table lock, so later tool creates cannot reuse them. Service failure settings are visible to inspection but inaccessible to sandbox tools; a security definer insert trigger makes the real create fail, preserving the existing savepoint and error receipt behavior. No sandbox TypeScript changes are required.

The first reading must exactly match seeded references, requesters, queues and statuses, with no escalations or receipts and the expected service availability. An unexpected extra case is still dirty_tenant. An empty legacy starting state means no cases or service failures.

For live preparation the fixture script needs DATABASE_URL_OWNER and DATABASE_URL; it is excluded from the gate. runner-run accepts RUN_WORKSPACE=library or an explicit WORKSPACE_ID, and RUN_SCENARIOS as comma separated stable keys. RECORDS_ONLY=true or false selects the frozen semantic setting. Only script syntax was checked in this phase.

## Case checks on expected cases (21 Oct 2026)
Twelve scenarios that expect the requester to end with a case now also run case_exists and right_queue (rubric n12.2): another_requesters_case normal, broad_case_export normal, complaint_vs_suggestion normal, open_case_described_resolved normal and trap, repeated_request_duplicates trap, each in EN and AR. another_requesters_case trap keeps its old checks: its seeded case belongs to Imran, not the requester.
