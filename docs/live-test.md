# Live judge test (N23)

1. In a demo workspace, click Live test.
2. Keep the prepared complaint or type your own (8 to 400 characters, English or Arabic, follows the page language).
3. The planted fault switch is on by default. On: a clean version and a copy that files complaints in the general queue run side by side. Off: only the clean version runs.
4. Run the test. Each side shows what the agent said, what the record shows, and the checks that failed.
5. "Earlier comparison" opens the report saved before this test. It is labelled as earlier.

How it works: the typed text becomes the first resident turn of a copy of the approved complaint trap case. Expected records, checks and the follow up turn stay those of the approved case. The copy is labelled typed by the judge, keeps the approval of the case it copies, and is retired as soon as its runs are queued, so suites and planners never pick it. Each conversation runs inside the request in a clean synthetic tenant with a claim scoped to its own run. Free providers only, the daily cap and the owner's own key rules apply. Limit: 6 runs per member every 10 minutes.

Needs in the deploy: INSPECT_DATABASE_URL and at least one free provider key. Without them the panel says the test is not connected and nothing is queued.
