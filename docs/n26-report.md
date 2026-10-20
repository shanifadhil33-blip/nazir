# N26 caller language, plan budget, lessons, and causes

Backend only. No screens. No new migration. No new AI provider.

## Errors
Every refusal from chat, the MCP connector, and the HTTP APIs uses one catalog line per code, in English or Modern Standard Arabic. The caller language is Arabic when the message contains Arabic letters, otherwise when Accept-Language asks for Arabic. The thrown error text stays English so existing checks keep matching. Impersonation and a forbidden role are in that catalog, including a 403.

## Plans
A chat message that does not state a number no longer sends a fixed budget of 8 calls. The planner sets the budget to the call cost of the first test after lesson and failure ordering, including a harder repeat. The reply states how many calls the plan uses. A number the caller states is still honored and can still be too small.

## Lessons
Bounded plans now read `nazir.lessons`, store `lessons_used`, and pass those lessons into `enqueueRun`. The runner already freezes them on the manifest, and the judge already reads that manifest. A chat correction with a lasting phrase is written before the plan for that turn is built, so the next plan order changes.

## Library keys and causes
A new library fixture does not insert the legacy `complaint_en` and `complaint_ar` rows. Existing rows are left in place. `chooseScenarios` prefers the library row, prints the chosen id when it skips an older row, and refuses the key when two library rows still match. Root cause uses the receipt and the claim when they support adapter, workflow, or instruction causes. A duplicate check with one successful create receipt stays unknown.

## Live checks
No migration to apply.

1. Call a signed out API with `Accept-Language: ar` and confirm the unauthorized line is the Arabic catalog sentence.
2. In chat, send "propose a plan" with no number. The reply should contain a plan and the call count.
3. Send a sentence that contains "always" or "دائما" away from the start. The next plan should put that family or queue first, and a started run should freeze the lesson.
4. On the existing hosted library workspace, a runner selection should print the library scenario id for `complaint_en` and `complaint_ar` and should not delete the older rows. A newly prepared fixture should contain one row for each of those keys.
