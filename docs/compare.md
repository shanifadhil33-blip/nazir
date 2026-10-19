# Version comparison (N17)

`compareRuns` (owner or reviewer) compares two finished runs and stores the result in `nazir.comparisons`, append only, with a hash of the summary and pairs.

* Pairs: same scenario, language and repeat (`stable_key:language:repeat`). A scenario whose content hash changed is listed as unpaired, never compared.
* Classes: improved, regressed, still failing, still passing, inconclusive, unpaired. Inconclusive is counted apart and is never a pass.
* Every number has a denominator: "Version B improved X of N paired tests." and the Arabic line.
* Regressions list the checks that newly fail. Improvements list the checks that newly pass.
* Failover is recorded per conversation on both sides, from `model_calls` and the conversation flag.
* Settings that differ between the two manifests (AI chain order, judge chain order, rubric, judge prompt, records only, rule pack, tool manifest, runner) are listed so a reader knows when a comparison is not like for like.
* Language parity pairs English and Arabic of the same meaning; it is a review signal, not proof of unfair treatment.
* Suppliers and viewers read a projection (`read_comparisons`) without hidden case details.

Live check: `scripts/compare-versions.mjs` with RUN_A and RUN_B, or PROPOSAL_ID for old run versus retest run; JUDGE_PAIRS=true adds a capped pair review (MAX_CALLS 10).
