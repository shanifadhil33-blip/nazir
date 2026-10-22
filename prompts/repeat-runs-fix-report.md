Fixed while preserving the existing changes:

- Restored lesson driven attempts, validated from 1 to 3, with consistent estimates, manifest counts, and report totals.
- Added plan based estimates with a four call fallback.
- Added attempt and call counts to Arabic and English refusals.
- Added the CLI estimate line and documented `REPEAT_COUNT=1` for the full 48 case suite.

`pnpm gate` passed: lint, typecheck, all 1,367 tests, and build.

No real providers called, live migrations run, deployment, or commit.