Implemented N05. **`pnpm gate` passes: lint, typecheck, 403 tests across 17 files, and production build.**

Changed files include:

- [0004_roles.sql](/workspace/nazir/db/migrations/0004_roles.sql): role policies, author stamping, four eyes checks, approval snapshots, viewer restrictions and audit protection.
- [roles.ts](/workspace/nazir/src/server/auth/roles.ts), [guard.ts](/workspace/nazir/src/server/auth/guard.ts), [errors.ts](/workspace/nazir/src/server/http/errors.ts), and [services](/workspace/nazir/src/server/services/index.ts): bilingual labels, permission matrix, typed errors and all seven operations.
- PGlite helpers, role tests, migration expectations, live check, dependencies and [Roles documentation](/workspace/nazir/docs/data-model.md).

The matrix gives owners rule and release authority, suppliers adapter and repair authoring, reviewers quality decisions and lesson editing, and viewers restricted reads. Combined roles use their union; four eyes always wins. The full action matrix is documented.

Test counts:

| File under `tests/` | Passed |
|---|---:|
| roles/database.test.ts | 136 |
| roles/matrix.test.ts | 86 |
| roles/services.test.ts | 64 |
| db/audit.test.ts | 9 |
| db/content.test.ts | 8 |
| db/driver.test.ts | 4 |
| db/live-check.test.ts | 1 |
| db/migrations.test.ts | 3 |
| db/runtime.test.ts | 4 |
| db/security.test.ts | 10 |
| gate.test.ts | 7 |
| health.test.ts | 2 |
| no-ai-look.test.ts | 23 |
| no-dash.test.ts | 8 |
| no-jargon.test.ts | 29 |
| no-optional-copy.test.ts | 5 |
| pages.test.tsx | 4 |
| **Total** | **403** |

Decisions: followed the detailed database rules where the overview differed; preserved existing scenario hashes; added worker only member provisioning for the live check’s real role fixtures. Historical unknown authors remain nullable.

Nothing outstanding within scope. No screens or Auth.js added. Migrations 0001 through 0003 are unchanged. No remote database, prohibited secret paths, commit, push or deployment used.