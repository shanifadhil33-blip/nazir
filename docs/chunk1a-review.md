# Chunk 1A review

Working tree based on `nazir/1a-connect-home`, `47a1dfd`. No commit, push, merge, migration apply or deployment was performed.

## Product and implementation

- Real Home shows exactly two connection choices before a successful test. Both use the same panel and save an API connection. The full choice explains that the SDK can be added later. It exposes no SDK files, keys, snippets, signing, tool success or readiness claims.
- Save uses PUT, then POST tests the saved revision. Only a successful test enables Start. A revision change between requests is refused before sending. Existing credentials are reused only for the same address, header and revision. A changed address cannot receive an old credential.
- Connected Home shows the first check action or latest completed score, the agent status and the next actions. Stat cards link to that completed check. Shared queued and running checks appear first and withhold another Start. Failed progress reads retain the last card and do not establish emptiness.
- Header status comes from trusted account kind and the safe connection projection. Workspace and settings names are not used as connection evidence. Settings links back to the same Home panel. The new panel links and Back preserve Arabic when the language is pinned in the URL. People contains one person without role metadata or chips.
- Home has no Settings tile. Settings remains in the avatar and desktop nav. Floating labels are visible, one line, with a filled current pill. The nav height is 76 px plus its bottom offset and safe area. Fixes reserves 112 px plus the safe area for the enlarged bar.
- A2A normalizes 1.0 and 0.3 cards and supports JSONRPC and HTTP+JSON, header API keys, bearer, immediate messages, bounded Task polling and cancellation. It omits a context on the first turn and reuses the agent's returned context. OAuth and required unsupported extensions are refused.
- Card fetches, selected interfaces, messages, polling and cancellation use public HTTPS checks, pinned socket lookups, TLS verification and no redirects. Authenticated interfaces on another origin are refused. Card and reply reads are capped at 64 KiB. Only normalized card name, skills and interface metadata are stored. Advertised URLs containing credentials, query strings or fragments are refused. Keys and raw transport errors are not returned.
- Real direct Start refuses missing and untested connections. Demo Start uses the built in sample even if a legacy external connection row exists. PR 92 scheduling, shared Stop, attempt limits and check dates remain in place.
- Saved reports, projected reads and PDFs carry the tested agent name and reply scope from the frozen check, independent of later connection changes. Missing inside evidence remains inconclusive. The database's existing fixed scope statement is preserved.
- Public Simple message and reply and A2A sample wrappers share the sample service policy. They are intentionally stateless and explain that they do not save requests. They accept no tenants, requester identities, versions or model settings and call no database or paid model. A bounded process limiter allows 60 calls per caller and 600 overall per minute. These limits are per process, not a distributed quota. The original protected sample route retains authentication.
- New copy is paired in English and Arabic, including the exact approved `connect.simple` wording. Arabic still needs native review.

## Migration

`db/migrations/0038_connections.sql` is written and tested only on isolated PGlite databases. It adds only the approved connection metadata columns to `nazir.external_agents`, widens the format constraint, and replaces the necessary read/save/remove/test function bodies. It preserves existing API connections, tested timestamps on upgrade, function signatures, grants, FORCE RLS and the database roles. Changes reset readiness; stale test revisions cannot restore it. Demo writes are refused in the service and SQL functions.

Bilal applies 0038 later using the already taken backup and the normal migration process after the gate is green. Nothing in this work invokes the production migration runner.

## Knowledge and QA accounting

Reviewed the context's Nov 12 08:20 Dubai override, approved 1A plan, relevant A2A design and build brief, and relevant entries across `build-knowledge/known-issues.md`, `lessons.md`, `universal/`, `design/`, `product-logic/` and `qa-findings/`. Relevant checks cover server first paint, safe secrets, solo Start, real links, attached controls, translated copy, visible nav labels, safe area clearance, immediate feedback, 140 ms color/transform transitions, keyboard focus and reduced motion. Unrelated project rules and later Nazir chunks are outside this change.

The 12 Home stat card NOT-CLICKABLE rows and the named header, People, nav, Settings tile and missing connect issues have implementation and unit coverage. They are not claimed as live verified. No browser automation or deployment was run.

Explicitly still open, as required by plan item 39: the lost-after-chain watchdog gap, eight suspected DEAD-CONTROL rows, one SAME-AS-OTHER row, five earlier Arabic keys awaiting native review and snapshot heading joins. Existing Topic/Language settings behavior belongs to the later Settings chunk. No SDK runtime, signing infrastructure, ingest, sessions, safety tables or cron was added.

## Bilal's live verification

1. After the external gate and later migration/deployment, connect a fresh real account to the public Simple message and reply sample, then its A2A card. OpenAI chat is covered by fake-server tests.
2. Verify save/test status immediately, after reload and in a second browser. Failed tests must leave Start unavailable. Check both connection choices and Change/Add the SDK Back and reload behavior.
3. Start an answers check, close every tab and confirm server completion. Verify the same completed check's Replies only scope in its report and PDF after changing the connection.
4. Run the focused crawl and persistence checks in English and Arabic at 390 by 844 and 1440 by 900. Check the labelled nav at 360 and measure Before and after above it at 390 with a safe area.
5. Confirm the preserved demo checks and existing walkthrough behavior. The 2 minute 8 second PR 92 close-the-phone result has not been remeasured by this change.

## Verification log

Focused Node 22 runs cover adapters, connection routes, SSRF/pinning, migration upgrade, demo mutation refusals, revision races, direct Start, all Home states, member first paint/refresh, nav, People, reports, PDF labels, English/Arabic parity, no dashes and no jargon. Final gate results are recorded in the implementation handoff.

Two existing runner-loader tests conditionally skip in this sandbox when their child-process feature probe cannot observe `registerHooks`. Their actual loader commands were also run directly on Node 22: pack runtimes returned `real_estate,ecommerce,clinics,schools`; all five Quick selections returned `8`. No test was deleted or newly skipped.

### Final handoff gate

Run with `/home/box/.local/node22/bin` in PATH, Node v22.23.3:

- `pnpm gate`: lint passed, typecheck passed, all 159 test files passed, 2,570 tests passed and the two existing conditional loader tests skipped. Their two actual loader commands passed directly, as described above.
- `next build` compiled successfully in 23.5 seconds, then exited with `Could not parse output from TypeScript's --showConfig.` The direct `pnpm exec tsc --showConfig` output parses as valid JSON. No sandbox workaround or Next configuration change was added. The complete gate must be rerun outside this sandbox before applying 0038.
- Six existing Turbopack warnings concern dynamic filesystem tracing in the library/pack loaders. These files were not changed by 1A.
- The Next route manifest contains the protected agent route and all three new public sample/card routes.
- `git diff --check` passed. Branch and HEAD remain `nazir/1a-connect-home` at `47a1dfd`.

Focused runs included all named files in plan items 33 through 36: settings external agent/routes/net guard/outbound pinning, runner external agent and queue, demo Start, auth shell data, Home/completion/shell/header/People/Checks/member data, report/PDF tests, no dashes and no jargon. Added suites cover A2A, migration upgrade, public sample isolation/authentication/limits and the connect card. Additional regression assertions cover stale save/test revisions, saved-key races, returned A2A contexts, cancelled tasks, frozen agent names and report scope after removing a connection. The last focused run passed 74 tests across 11 files. No live success is asserted by these unit and PGlite checks.
