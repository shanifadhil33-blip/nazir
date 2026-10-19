Implemented N06: sandbox migration, frozen bilingual rules, four tools, agent loop, model client, protected route, smoke script and docs.

`pnpm gate` passes: **428 tests across 21 files**, plus lint, type checking and production build. Includes 25 new sandbox tests.

[Completion report with files, decisions and per-file test counts](/workspace/nazir/docs/n06-report.md)

Existing migrations remain unchanged. No real AI calls, remote database connections, secret access, commits or pushes. The smoke script was checked but not run, as requested.