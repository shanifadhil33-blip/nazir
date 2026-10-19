Implemented N07/N08 with baseline hashes pinned and existing migrations unchanged.

`pnpm gate` passed: lint, typecheck, **484 tests across 24 files**, and build.

[Report with files, hashes, and per-file test counts](/workspace/nazir/docs/n07-n08-report.md).

Live check was not run. Its positive read requires committed fixtures via `INSPECT_CHECK_TENANT`, because separate connections cannot see rolled-back app inserts. This deviation is documented.