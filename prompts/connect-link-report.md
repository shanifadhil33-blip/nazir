Implemented owner-only agent connections with both formats, sealed secrets, SSRF protection, rate limits, bilingual UI, and external runner support. Record checks remain inconclusive without a records link; replies still receive rubric and knowledge review.

`pnpm gate` passed on Node 22: 1,402 tests and production build. Existing loader tracing warnings remain.

[Migration 0030](/workspace/nazir/db/migrations/0030_external_agent.sql) is supplied unapplied. No real endpoint calls, deployment, or commit.