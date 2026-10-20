# N20 to N24 report

Backend only. No screens. The print route is HTML for the browser print dialog, not a designed page.

## Migrations
0016_reports.sql adds `nazir.reports`. One insert stores the full copy, the development copy and the viewer copy from the same evidence read. A check requires both scope sentences. Raw rows are readable by the service owner and the quality reviewer. The supplier reads `nazir.read_report` (development copy). The viewer reads `nazir.read_report_viewer`. A viewer select on the table returns nothing, and `read_report` raises "Your role cannot do this." Reports are frozen after insert.

0017_agent.sql adds `nazir.agent_threads`, `nazir.agent_messages` and `nazir.mcp_tokens`. Tokens are SHA256 only, unique, and revocable once. `nazir.mcp_resolve` returns an active member for a live hash.

0018_demo_reset.sql adds `nazir.demo_store` and `nazir.demo_reset_log`. `nazir.demo_recycle` deletes the oldest demo store row or agent message until the workspace is within the byte cap, then drops empty threads. Scheduled calls skip when a schedule log is newer than 6 hours. Locks use SKIP LOCKED and a 200ms lock timeout. The function does not name sign in tables. A real workspace is refused. App roles still have no DELETE grant. The recycle function is security definer.

0019_viewer_audit.sql lets a viewer append only `agent.message`, `mcp.issued` and `mcp.revoked`. Any other viewer audit action still raises "Your role cannot do this."

## Behaviour
N22 `proposeBoundedPlan` walks failure history first, then family name, and stops when the next scenario would pass the call or cost ceiling. Stored `budget_calls` is the planned call count, which is within the ceiling. Tools and permissions on the plan are a subset of the adapter manifest (or the sandbox tools) and the member's current permissions. The worker applies a bounded stop rule after a conversation finishes: a failure streak or a spent call budget cancels queued conversations.

N20 scope wording, in both stored copies: "These results are within tested scope, not a certificate." Arabic: "هذه النتائج ضمن النطاق المختبر، وليست شهادة."

N21 chat and `POST /api/mcp` share `runPlannerTool`. The tools are list runs, list findings and propose a plan. An unknown tool is refused. The free AI chain is optional. A scripted or missing chain falls back to the message text. Chat uses the existing provider chain and task `live_demo`. No new provider was added.

N24 cron is `GET /api/cron/demo-reset` on `0 3 * * *` (Vercel Hobby allows daily crons only; the 6 hour guard still applies). On demand is `POST /api/workspaces/:id/demo-reset` for a service owner.

## Environment
`CRON_SECRET` is required for the cron route. `DEMO_STORAGE_CAP_BYTES` is optional and defaults to 262144. No new AI keys.

## Gate
lint, typecheck, 1204 tests (55 files), build: pass.

## Live check still required
Apply 0016 to 0019 on Neon with the owner URL. Set `CRON_SECRET` on Vercel and confirm the 6 hour cron. Open a saved report print URL and an MCP issue then revoke against the live database. Sign in during a demo reset was checked in PGlite, not on Neon.
