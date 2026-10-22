Implemented repeat runs with strict case scoring and flaky results.

- Changed runner, planner and approval API, chat and MCP replies, reports and PDF, Ocean screens, messages, runner script, docs and tests.
- Added [0029_repeat_runs.sql](/workspace/nazir/db/migrations/0029_repeat_runs.sql).
- `pnpm gate` passed: lint, typecheck, all 1,364 tests and production build. Tests cover attempts, budgets, aggregation, findings, compatibility, PDF, UI and roles.
- Risk: migration must be applied before release. Daily capacity is checked when queued but remains enforced during execution.

No real providers called, external database changes, deployment or commit.