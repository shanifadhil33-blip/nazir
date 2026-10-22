# New cases and Connect by link report

Added 28 ideas as 56 bilingual cases. Full suites now contain 296 cases: Government 58, Real estate 58, Ecommerce 58, Clinics 58, Schools 64. Each pack still selects its original 16 quick check cases.

## Added cases

Each identifier below has an `_en` and `_ar` version. Non Government identifiers include the prefix used when installed; inline JSON stores the part after that prefix.

- government (5 ideas, 10 cases): `kb_amnesty_rumour`, `kb_salary_forgery`, `kb_documents_on_file`, `kb_eastern_reference`, `kb_claimed_supervisor`.
- real_estate (5 ideas, 10 cases): `re_kb_decree_slab_five`, `re_kb_decree_no_increase`, `re_kb_renewal_notice_thirty`, `re_kb_cousin_eviction`, `re_kb_ejari_published_fees`.
- ecommerce (5 ideas, 10 cases): `ec_kb_saudi_rescission_day_four`, `ec_kb_saudi_delivery_twenty_late`, `ec_kb_uae_invented_return_right`, `ec_kb_voice_call_restrictions`, `ec_kb_voice_identity_consent`.
- clinics (5 ideas, 10 cases): `cl_kb_employer_attendance`, `cl_kb_mri_personal_whatsapp`, `cl_kb_advertising_guarantee`, `cl_kb_self_harm_emergency`, `cl_kb_ai_virtual_consultation`.
- schools (8 ideas, 16 cases): `sc_kb_application_fee_cap`, `sc_kb_deposit_before_offer`, `sc_kb_reregistration_cap_math`, `sc_kb_fee_increase_day_eight`, `sc_kb_withdrawal_date_refund`, `sc_kb_term_one_payment_cap`, `sc_kb_arrears_to_parent_only`, `sc_kb_unpaid_fees_exam_access`.

## Grounding and skipped cases

Skipped: none. All 28 ideas are supported by the five verified merged KB files under `/home/box/shared/adhil/championship/nazir/kb-research/merged/`. Every new source quotation was checked for an exact match. All original case objects and quick definitions were compared with HEAD and remain unchanged.

Each new case stores bilingual goals and pass/fail criteria, rubric tags, a KB filename, section and quotation, and labelled synthetic context inside expected state. These survive import and reach both internal and external reply judges and findings. New policy requirements use semantic assessment; existing record checks continue to check actual records and unexpected actions. Self harm escalation and typed supervisor authority are labelled service practice rather than law.

The numeral case retains identifier 4471 in the required sandbox reference `NZ-004471`, with `NZ-٠٠٤٤٧١` in Arabic. Documents already on file are labelled synthetic context; this change adds no document storage model.

## Connection fixes

Private literals, local names and DNS answers containing any private address return `external_private_address` with clear English and Arabic safety copy on save, test send and runner reports. The runner retains this code instead of replacing it with `bad_evaluator`.

One DNS resolution validates every answer. Native HTTPS then uses a lookup callback containing only the checked IP, the original URL for Host, the original hostname for SNI, and certificate validation. Each call uses a fresh connection and refuses redirects. Checked connections reject benchmark IPs even when the legacy development DNS flag is enabled. No new dependency was needed.

## Files changed

- Root: `next.config.ts`.
- messages/: `ar.json`, `en.json`.
- src/: `components/ocean/external-agent.tsx`, `server/findings/build.ts`, `server/findings/pack.ts`, `server/http/errors.ts`, `server/judge/rubric.ts`, `server/library/assessment.ts`, `server/library/load.ts`, `server/library/scenarios/another_requesters_case.json`, `server/library/scenarios/correct_reference_rules.json`, `server/library/scenarios/missing_required_details.json`, `server/library/scenarios/mixed_names_and_numerals.json`, `server/library/schema.ts`, `server/packs/clinics/cases.json`, `server/packs/clinics/pack.json`, `server/packs/ecommerce/cases.json`, `server/packs/ecommerce/pack.json`, `server/packs/government/pack.json`, `server/packs/install.ts`, `server/packs/load.ts`, `server/packs/real-estate/cases.json`, `server/packs/real-estate/pack.json`, `server/packs/schema.ts`, `server/packs/schools/cases.json`, `server/packs/schools/pack.json`, `server/reports/build.ts`, `server/reports/read.ts`, `server/runner/worker.ts`, `server/settings/agent-settings.ts`, `server/settings/external-agent.ts`, `server/settings/net-guard.ts`.
- tests/: `ai/probe.test.ts`, `clinic/clinic.test.ts`, `estate/estate.test.ts`, `inspection/channel.test.ts`, `library/import.test.ts`, `library/new-cases.test.ts`, `library/schema.test.ts`, `packs/pack-runner.test.ts`, `packs/packs.test.ts`, `packs/quick-flow.test.ts`, `repair/repair.test.ts`, `runner/external-agent.test.ts`, `runner/library-fixture.test.ts`, `runner/library-journeys.test.ts`, `runner/scripts.test.ts`, `school/school.test.ts`, `settings/agent-settings.test.ts`, `settings/external-agent.test.ts`, `settings/external-routes.test.ts`, `settings/net-guard.test.ts`, `shop/shop.test.ts`.
- prompts/: `new-cases-connect-fix-report.md`.

## Validation

`PATH=/tmp/node-v22.23.4-linux-x64/bin:$PATH pnpm gate` passed with Node v22.23.4: lint, full typecheck, tests, and production build. Final test count: Tests  1424 passed | 2 skipped (1426). All 89 test files passed. The two existing capability guarded runner loader tests were skipped because their subprocess feature probe returned no output in this sandbox. Existing dynamic filesystem tracing warnings remain nonfatal.

Existing script checks use asynchronous subprocess capture because synchronous captured subprocesses return EPERM in this sandbox. The same scripts and exit statuses are checked. The installed Next 16 guide supports `experimental.useTypeScriptCli: false`, used here to retain build type checking through the compiler API when CLI output capture is unavailable; the gate also runs the full standalone TypeScript check. No real endpoint or provider calls were made. Tests use the existing in memory database fixtures only. No database migration command, commit or deployment was run; no secret files or home Codex files were accessed.
