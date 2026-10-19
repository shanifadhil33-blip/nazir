# N04 and N12 report

Implemented Google sign in backend and the bilingual fictional test library on 19 October 2026. No designed screens were added. Privacy and terms are plain English and Arabic pages.

## Files changed

Added:

* `db/migrations/0009_auth.sql`
* `db/migrations/0010_library.sql`
* `src/auth.ts`
* `src/app/api/auth/[...nextauth]/route.ts`
* `src/app/api/me/route.ts`
* `src/app/api/workspaces/route.ts`
* `src/server/auth/adapter.ts`
* `src/server/auth/session.ts`
* `src/server/auth/shape.ts`
* `src/server/auth/workspaces.ts`
* `src/types/next-auth.d.ts`
* `src/server/library/schema.ts`
* `src/server/library/load.ts`
* `src/server/library/import.ts`
* Twelve `src/server/library/scenarios/<family>.json` files, listed below
* `tests/auth/adapter.test.ts`
* `tests/auth/config.test.ts`
* `tests/auth/routes.test.ts`
* `tests/auth/session.test.ts`
* `tests/library/schema.test.ts`
* `tests/library/import.test.ts`
* `docs/test-library.md`
* This report

Updated:

* `package.json` and `pnpm-lock.yaml`: Auth.js v5, `next-auth@5.0.0-beta.32`.
* `scripts/db-roles.mjs`: adds `nazir_auth` to the application login memberships.
* `src/server/http/errors.ts`: worded Unauthorized error mapped to 401.
* `src/app/privacy/page.tsx` and `src/app/terms/page.tsx`: current bilingual disclosures and new contact address.
* `tests/pages.test.tsx`: address, bilingual structure, storage and acceptable use assertions.
* `tests/db/migrations.test.ts`: expected ledger now includes migrations 0009 and 0010.
* `tests/db/security.test.ts`: catalog count includes three new tables. Auth tables and library exposure are excluded from the older fixture loop because their separate tests exercise their distinct access models; the all-table forced RLS assertion still includes them.
* `vitest.config.ts`: bundles Auth.js dependencies in tests so Next's extensionless server imports resolve.

Existing migration files, sandbox source, demo scenario source, shared fixture files and pinned sandbox hash tests were not changed. Existing grants and policies were not changed. The pre-existing untracked task prompt and runner output in `prompts/` were left alone.

## Auth storage and authority

`nazir.auth_accounts` stores only user ID, provider and Google account ID. `(provider,provider_account_id)` is the primary key. Provider is restricted to Google. No provider access, refresh or ID tokens are stored. `nazir.auth_sessions` stores SHA256 session token hash, user ID and expiry, with an expiry index. Raw session tokens exist only at the Auth.js boundary. Both new tables enable and force RLS and give no direct access to any runtime role, including `nazir_auth`.

`nazir_auth` is NOLOGIN. Its only Nazir data authority is execute on these SECURITY DEFINER functions, with `search_path=pg_catalog,nazir`. Schema USAGE permits resolving their names. PUBLIC has no execute rights on them:

| Function | Purpose | Execute grant |
| --- | --- | --- |
| auth_create_user(text,text,text) | Create lowercase email identity | nazir_auth |
| auth_get_user(uuid) | Find identity by ID | nazir_auth |
| auth_get_email(text) | Find normalized email | nazir_auth |
| auth_get_account(text,text) | Find linked Google identity | nazir_auth |
| auth_update_user(uuid,jsonb) | Update used profile fields | nazir_auth |
| auth_link_account(uuid,text,text) | Link Google account ID | nazir_auth |
| auth_unlink_account(text,text) | Unlink account | nazir_auth |
| auth_create_session(text,uuid,timestamptz) | Save token hash and expiry | nazir_auth |
| auth_read_session(text) | Remove expired sessions and read session with user | nazir_auth |
| auth_update_session(text,timestamptz) | Renew a live session | nazir_auth |
| auth_delete_session(text) | Delete by token hash | nazir_auth |
| auth_memberships(uuid) | Active memberships for signed in user context | nazir_auth |
| auth_create_workspace(uuid,text) | Real workspace, owner membership and chained audit event | nazir_auth |

Each adapter call reserves a transaction and selects `SET LOCAL ROLE nazir_auth`. Membership and workspace calls also set transaction-local `app.auth_user_id` from the trusted signed in identity. Their functions refuse missing or mismatched user context. Database errors are replaced with a fixed worded error; the Auth.js logger never prints the original exception, account email or tokens. App, worker, sandbox and inspector roles have no auth table grants or auth function grants. Administration must run migrations before the existing roles script. No administration or live database script was run here.

Google is the only provider. Credentials come from AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET and AUTH_SECRET. `trustHost` is true; scopes are exactly `openid email profile`; session strategy is database with a 30 day maximum age. The callback path remains `/api/auth/callback/google`. Provider discovery works when Google credentials are absent, including a safe metadata response when AUTH_SECRET is also absent; it does not substitute a fake signing secret. Missing credentials cause a worded 503 on Google sign in or callback requests and a worded exception from server `signIn`, without initializing a database connection. No custom sign in screen was added.

A new identity has no workspace. Workspace creation accepts only a name in the request body and takes user ID from `requireUser`. It creates kind real, gives the creator service_owner, and writes `workspace.created` with event-time actor name and roles in the same transaction. It never seeds demo records.

## Session and routes

`GET /api/me` returns:

```ts
{
  user: { id, name, email, image },
  memberships: [{
    workspaceId, workspaceName, kind, memberId,
    roles,
    roleLabels: { en: string[], ar: string[] }
  }]
}
```

Role labels correspond to the sorted roles in the same order. Removed memberships are excluded. The Auth.js session callback adds the same shape while retaining Auth.js expiry metadata. `requireUser` returns the public shape or throws Unauthorized. `requireMember(workspaceId)` returns memberId and roles or throws Forbidden. Trusted handlers can then use `withMember` and `requireRole` for the requested operation. The NextAuth session type includes memberships.

`GET /api/me` and `POST /api/workspaces` are dynamic and set Cache-Control no-store on success and error. Signed out calls return 401 JSON with “Please sign in to continue.”

Privacy discloses Google profile and account ID, 30 day session records, created workspace and test data, synthetic-only use, no government connection, third party AI processing, Vercel, Neon and deletion contact. Terms cover demonstration status, tested scope, no certificate, no live connection and acceptable use. Both include equivalent English and Arabic sections, the date 19 October 2026 and `shanifadhil022@gmail.com`.

## Library counts

| Group | Family | Split | Meanings | Scenarios |
| --- | --- | --- | ---: | ---: |
| Approved information | correct_reference_rules | development | 2 | 4 |
| Approved information | missing_required_details | development | 2 | 4 |
| Complaint intent | complaint_vs_suggestion | development | 2 | 4 |
| Complaint intent | unresolved_prior_request | development | 2 | 4 |
| Transaction truth | success_without_case | development | 2 | 4 |
| Transaction truth | wrong_routing_queue | hidden | 2 | 4 |
| Case lifecycle | open_case_described_resolved | development | 2 | 4 |
| Case lifecycle | repeated_request_duplicates | hidden | 2 | 4 |
| Privacy and authority | another_requesters_case | development | 2 | 4 |
| Privacy and authority | broad_case_export | hidden | 2 | 4 |
| Language and inclusion | english_msa_equivalent | development | 2 | 4 |
| Language and inclusion | mixed_names_and_numerals | hidden | 2 | 4 |
| Total | 12 families | 8 development, 4 hidden | 24 | 48 |

Each family has a normal meaning and a trap, each with English and MSA twins in one split. All people are invented men from the sandbox requester set. Expectations are fictional demo rules. Existing clause IDs are checked against the pinned demo rule pack; additional fictional rules have explicit labels. Tool names and check IDs are validated against the existing manifest and record checks. Arabic turns contain Arabic script; English turns do not. The existing complaint pair projects to exactly the unchanged demo scenario hashes.

The loader rejects duplicates, missing twins, split drift, wrong group, unknown fields, filenames, tools, checks and clauses. It hashes canonical source scenarios and meanings. Tests pin whole-library digest `d360bd58e9e4962b3c1e6d2e03af9962f6edf06f45dff34800c97b24fd55546d`. Database hashes preserve their existing JSONB format; source hashes are stored separately in library_hash and canonical meaning metadata.

Imports require scenario.write within withMember, use a workspace advisory lock, reuse unchanged versions and insert changes as new drafts. Approval requires scenario.approve and another human, stamps approved_by and approved_at, and appends audit. Generated content starts draft and stays outside regression until human approval. Regression returns only approved scenarios. Existing approved-content triggers include the added fields; a new trigger also freezes approved meanings. No approved content is edited in place.

Migration 0010 also adds `library_fix_usage`: app SELECT and INSERT only, with workspace, current member and owner/reviewer checks. Worker has no grant. Fix exposure is separate from immutable content. Marking either twin makes both languages and later meaning versions with the same meaning key unseen=false. Hidden reads require the server role check and existing RLS policies; suppliers and viewers are refused at both boundaries.

## Validation

Targeted tests: 70 passed across 10 files.

| New test file | Tests |
| --- | ---: |
| tests/auth/adapter.test.ts | 12 |
| tests/auth/config.test.ts | 3 |
| tests/auth/routes.test.ts | 2 |
| tests/auth/session.test.ts | 2 |
| tests/library/schema.test.ts | 18 |
| tests/library/import.test.ts | 10 |
| New files total | 47 |

Additional targeted files: pages 8 tests, migrations 3, database security 10 and pinned sandbox versions 2. Pages gained four tests. Auth tests cover real PGlite adapter calls, actual Auth.js provider discovery and session callback with fake credentials, expiry cleanup, raw token absence, all runtime table refusals, pinned function privileges, user context binding, memberships, roles, audit writes and signed out routes. Library tests cover validation, hashes, demo identity, draft import, approval, immutability, new versions, generated exclusion, hidden refusal and exposure across twins and changed meaning versions.

The four required copy files pass all 65 tests: no-dash 8, no-jargon 29, no-ai-look 23, no-optional-copy 5. Library JSON has its own copy scan as well.

Final `pnpm gate` exited 0: lint, typecheck, all 962 tests across 41 files, and the Next.js production build passed. Targeted tests and the four copy files passed immediately before this final gate. `git diff --check` passed. A protected-path diff confirmed no edits to migrations 0001 through 0008, src/sandbox or tests/sandbox/versions.test.ts.

## Decisions and limits

No requested storage, auth or library lifecycle work is deferred. Gulf phrasing is deliberately excluded and waits for a native reviewer. The original MSA wording has not received independent native review and makes no reviewed-language claim. Relative requester references preserve the existing English/Arabic complaint fixtures. English mixed-numeral twins use the normalized identifier without Arabic script, while Arabic twins exercise explicitly equivalent eastern digits and mixed-script names.

The library is data and approval infrastructure. The N11 evaluator remains its existing complaint journey evaluator; it does not claim to judge information accuracy or refusal meaning for every family. Those expectations need semantic or human review. The existing runner does not automatically prepare new existing-case or failed-tool fixtures from library starting_state. This task's tests exercise library storage and authority, not model performance across the 48 scenarios. No live Google authentication, provider availability, email deletion workflow or concurrent remote PostgreSQL lock behavior is claimed. Privacy supplies the requested manual deletion contact.

Node v22.23.3 was verified. Every shell command used the requested PATH prefix, all package commands used pnpm, and all tests used PGlite or fakes. No real Google or AI call, remote database connection, Vercel command, commit or push was made. No secrets directory was read. Shared reference documents were read only and no file outside the repository was edited.
