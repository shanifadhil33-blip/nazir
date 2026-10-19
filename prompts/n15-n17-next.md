# N15 to N17: what is left for the live part (network was down on Oct 20)

Code is committed at b4f025a (and this note after it). Do these in order once the box reaches the internet (check: `curl -sS -o /dev/null -w "%{http_code}" https://github.com`). Secrets stay in /workspace/nazir-secrets; never print them.

1. `git push origin main`, then wait for the Vercel production deploy and check https://nazir-liard.vercel.app/api/health is ok.
2. Apply migrations 0013_compare, 0014_repair, 0015_memory on Neon project muddy-violet-20208073 with scripts/migrate.mjs and the owner URL, the same way as prompts/n13-n14-neon-migrate.txt. Save as prompts/n15-n17-neon-migrate.txt.
3. Rerun db-roles, db-live-check, sandbox-live-check and inspection-live-check (as in prompts/n13-n14-neon-*.txt); save as prompts/n15-n17-neon-*.txt.
4. Rerun scripts/runner-library-fixture.mjs once: it adds the supplier member Yusuf Rahman (library_supplier@example.test). A second run must change nothing.
5. Live checks with real free models (DATABASE_URL = app login, INSPECT_DATABASE_URL = inspection login):
   * `MAX_CALLS=40 RUN_SET=retest node scripts/repair-cycle.mjs` needs an open planted wrong queue right_queue finding (from the N13 live run). Expect OLD_RECORDS SAME. Save prompts/n15-n17-live-repair.txt.
   * `PROPOSAL_ID=<from above> node scripts/compare-versions.mjs` (add JUDGE_PAIRS=true MAX_CALLS=10 for a capped pair review). Save prompts/n15-n17-live-compare.txt. Report "improved X of N paired" with EN and AR.
   * `MAX_CALLS=6 MAX_RUN_CALLS=12 node scripts/memory-check.mjs` then `LANGUAGE=ar` again. Expect LESSON_CHANGED_PLAN YES and LESSON_NAMED_IN_FINDING YES. Save prompts/n15-n17-live-memory-en.txt and -ar.txt.
   Scripts cancel what is left at the cap, so nothing stays queued.
6. `pnpm audit` and add the result to prompts/n15-n17-security.txt; repeat the cross workspace checks against Neon.
7. Update the N15 to N17 ledger rows with the live proof and commit the live outputs.
