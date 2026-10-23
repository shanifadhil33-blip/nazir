Fix a judge fault in pack runs (non Government packs: real-estate, ecommerce, clinics, schools).

Evidence (runs adb360fa, f2ba36f8, f5fe8c29, Oct 23): the baseline agent correctly quoted rules that ARE in its own policy (src/sandbox/*/policy.ts), but the judge marked them false_claim:
- real estate: "changing terms on renewal requires at least 90 days notice" (rule re.10) -> judge said rules only specify 12 months.
- ecommerce: "store policy allows returns within 14 days" (ec.2, ec.6) -> false_claim.
- clinics: "clinic policy (clause 7) says never advertise guaranteed results" (cl.7) -> false_claim.
Cause: src/server/runner/worker.ts buildPackJudgeInput gets only the scenario's single clause (rt.clause(c.source_clause)), so any other approved rule looks unsupported.

Task: give the pack judge the full list of that pack's approved policy rules (id + text in the conversation language, EN or AR) as supporting context, while keeping the scenario clause as the primary clause being tested. Update the judge prompt/rubric text so a claim that matches any listed approved rule is supported, and fictional store policy facts stated as store policy are supported. Keep Government path unchanged. Keep judge input size bounded (truncate sensibly). Add unit tests proving a reply citing another approved rule is not flagged by the input builder (test the builder output contains the rules; do not call real models). No dashes in user facing copy. Do not touch next.config.ts, .codex config, or auth. Do not add sandbox workarounds to the repo (no useTypeScriptCli false, no preload files committed). Write a short report to prompts/judge-full-policy-report.md.
