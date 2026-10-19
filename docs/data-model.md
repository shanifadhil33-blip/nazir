# Nazir data model

This phase stores fictional sandbox tests in schema `nazir`. Plain numbered SQL files in `db/migrations` are the source of truth. Once a file has been applied to a deployed database, add a later migration instead of editing it. The public `nazir_migrations` ledger records file name, SHA256 checksum and application time. The runner validates every previously applied file before applying new files and commits each new file with its ledger entry in one transaction.

## Roles and request context

`nazir_login` is a LOGIN with NOINHERIT and membership in the NOLOGIN roles `nazir_app` and `nazir_worker`. It has no direct rights on the Nazir schema. Runtime uses only `DATABASE_URL`. Owner credentials are used by administration scripts only. The migration owner must have BYPASSRLS, as required for security definer functions to read membership while row security is forced. Use a trusted owner, never an application role, to own these functions and tables.

`withMember` validates the member UUID, reserves a transaction, selects `nazir_app` with SET LOCAL ROLE, and sets transaction-local `app.member_id`. `withWorker` similarly selects `nazir_worker` and sets `app.workspace_id`. A failed request rolls back and always releases its connection. Role and context cannot carry into the next request. The login must never be shared with untrusted SQL clients: its permission to select both roles is intended for trusted backend code.

`current_workspace_id` resolves an active member's workspace for the app role, a supplied workspace for the worker, and null otherwise. Security definer functions examine `current_setting('role')` because their effective `current_user` is the owner. Every tenant policy checks workspace on both reads and writes. Missing context and removed members see nothing. Users are global but visible only through membership in the current workspace. Workspaces use their own id as the tenant boundary.

Every ordinary tenant table has a workspace id and unique `(workspace_id,id)`. Parent references use composite foreign keys. Member roles use `(member_id,role)` as their primary key and retain a generated id with a composite unique key. Audit events instead use `(workspace_id,seq)` as their identity. Structured evidence JSON, lesson source conversation arrays, and polymorphic approval subject ids are references for the application to validate, not relational foreign keys. They do not grant access to another workspace's records.

Both app roles may select records within their context. Neither has DELETE or TRUNCATE. Members manage definitions, plans, proposals and lessons; workers write execution records. Members can change finding status and owner role; workers can change only finding status. Bootstrap is the only app-accessible path to create a workspace, user and first member. N05 adds member authority with restrictive role policies and transition triggers, described below.

## Roles

A member may hold several roles. Permissions are their union. The pure `can` matrix in `src/server/auth/roles.ts` supplies the same authority to future app routes and agent tools. Every service validates its input with Zod, enters `withMember`, calls `requireRole` on that transaction connection, checks the subject, writes with bound values, and appends an audit event in the same transaction. Forbidden, missing record and validation errors map to 403, 404 and 400; other errors return 500 without internal details. These functions accept a trusted backend member context; sign in and HTTP routes are later work.

| Action | Service owner | Supplier maintainer | Service quality reviewer | Viewer |
| --- | --- | --- | --- | --- |
| Draft rule versions and write rule packs | Yes | Yes | No | No |
| Approve or retire rule versions | Yes | No | No | No |
| Register or edit adapters | No | Yes | No | No |
| Create or edit agents and versions | Yes | Yes | No | No |
| Create planted fault versions | Yes | No | No | No |
| Write scenarios and meanings | Yes | No | Yes | No |
| Approve scenario status | Yes | No | Yes | No |
| Record scenario approval | No | No | Yes | No |
| Propose and approve plans | Yes | No | Yes | No |
| Propose repairs | No | Yes | No | No |
| Approve or reject proposals | No | No | Yes | No |
| Override findings | No | No | Yes | No |
| Accept findings | Yes | No | Yes | No |
| Edit lessons and confirm small lessons | Yes | No | Yes | No |
| Activate or approve big lessons | Yes | No | No | No |
| Record release decisions | Yes | No | No | No |
| Read evidence and audit | Yes | Yes | Yes | No |
| Read hidden scenarios and meanings | Yes | No | Yes | No |

The detailed N05 database rules allow owners to draft rule versions and write agents and versions. Scenario status approval allows owners or reviewers; a scenario approval record requires a reviewer. Worker grants otherwise remain unchanged and workers have no approval insertion grant. The worker can create baseline or planted fault configurations only through its existing or future controlled execution paths; this migration adds no direct agent version grant to workers.

A viewer can read workspaces, members, member roles, rule packs, approved rule versions, agents, runs, findings and release approval records. Other approval subjects are hidden. Conversations, messages, tool events, state readings, adapters, agent versions, scenarios, meanings, plans, proposals, lessons, revisions and audit records require a nonviewer role. Suppliers see development scenarios but no hidden scenarios. A meaning linked to any hidden scenario is hidden from suppliers even if also linked to a development scenario. Adding viewer to another role does not remove that role's permissions.

The database is an independent enforcement boundary: restrictive command policies intersect the original workspace policy. Fixed search path security definer helpers resolve only an active app member. Triggers prevent author spoofing and author changes, constrain status transitions, check approval subject workspace and authority, and replace approval actor snapshots with event time name and sorted roles. Direct SQL cannot bypass these checks. Evidence immutability remains enforced. Scenario hashes exclude the new author metadata so existing approved hashes remain stable.

Four eyes always wins over combined roles: nobody can decide their own proposal or approve their own rule version, plan or scenario. Both approval rows and direct status transitions check authors. `created_by` is nullable for historical rows on rule versions, scenarios, plans, agent versions and adapters. App inserts always stamp it from the active member. Plan and proposal proposer fields are also stamped and immutable. Historical plan proposers remain protected; authors of older rows without recorded authors cannot be reconstructed and remain null.

`append_audit` refuses viewer only members; its internal implementation has no application or worker execute grant. Successful service events keep member name and roles at event time. The worker only `add_member(email,display_name,roles)` provisioning function derives workspace from worker context, validates the role list and appends a membership audit event. It provides the live check's real viewer and combined supplier/reviewer fixtures without granting membership writes to application members. The live check seeds real evidence and a proposal, checks both refusals and always rolls the whole transaction back.

## users

Global identities with unique lowercase email, name and image. Bootstrap upserts by normalized email. App roles can read identities belonging to their workspace and cannot write this table directly. Identity is not a versioned evidence record.

## workspaces

Real or demo tenant names and the creating user. Only bootstrap creates them for the worker. App roles can read only their current workspace and have no direct write grant.

## members

User membership, display name and active or removed state. Bootstrap creates the first member. App roles read within the workspace but have no direct writes in this phase; later membership administration will use a controlled path. Audit snapshots keep old display names after later changes.

## member_roles

One or more service owner, supplier maintainer, quality reviewer or viewer roles per member. Bootstrap grants service owner. App roles read but cannot write directly in this phase. Audit events copy roles at event time.

## rule_packs

Stable rule pack keys and titles. Members insert and update them. Versions hold the immutable approved content.

## rule_pack_versions

Numbered JSON rule content, approval metadata and a database-computed content hash. Members insert and update drafts. Once approved, every field is immutable except the move to retired; retired content stays frozen.

## agents

Agent names and descriptions. Members insert and update them. Tested configuration is held in agent versions.

## agent_versions

Baseline, planted fault or repair configuration, its computed hash, parent version and freeze timestamp. Planted faults require a nonblank fault label. Members write versions; frozen rows cannot change.

## adapters

HTTP or built in connection settings, allowed hosts, tool manifest and its computed hash, plus inspection and check metadata. Members insert and update. `inspection_ref` stores a secret name only; callers must never put a secret value there. Manifest changes recompute the hash.

## scenario_meanings

Language-independent scenario family and canonical JSON. Members insert and update. Specific language and expected outcomes live in numbered scenarios.

## scenarios

English or Arabic test versions with persona, initial state, permitted and forbidden actions, expected state, source clause, severity and rubric. Members write drafts and approval metadata. The hash covers scenario content, excluding identity, creation time, approval metadata, status and the hash itself. Approved rows can only move to retired; a changed result requires a new version.

## plans

Testing goal, pinned agent and rule versions, families, languages, repeats, positive call budget, stop rules and decision metadata. Members insert and update; workers can insert Nazir-proposed plans. Plans remain mutable in this phase; run manifests preserve the executed inputs.

## runs

Execution status, pinned versions, frozen JSON manifest and its computed hash, runner version, call usage and timing. Workers insert and update execution state. Manifest and hash cannot change after insertion.

## conversations

A run and scenario execution with language, status, idempotency key, attempt, lease, sandbox tenant and model information. Workers insert and update execution state. `(run_id,idempotency_key)` prevents duplicates. Conversation bodies are stored separately.

## conversation_messages

Ordered resident, agent and system messages. Workers append them; no role can update, delete or truncate rows while the guard triggers are enabled. Sequence is unique per conversation.

## tool_events

Ordered tool requests, responses, outcomes and a computed hash of the request and response object. Workers append them. Nonnull idempotency keys and sequence are each unique per conversation. Records cannot change after insertion.

## state_readings

Inspection channel JSON state, its computed hash and observation time. Workers append it as evidence of actual records. Records cannot change after insertion.

## findings

Deterministic, semantic or human findings linking run, conversation, scenario, rules and agent version with severity, ownership and evidence. Members and workers insert them. All fields except status and owner role are immutable; the worker may update status only.

## proposals

Evidence and suggested JSON patches linked to findings, expected benefits, regression concerns and resulting version. Members insert and update. Workers insert Nazir proposals. Proposal records are mutable; resulting agent versions have their own freeze rules.

## approvals

Decision, subject type and id, reason, evidence-opened flag and member name and roles at decision time. Members append; reasons must contain at least three trimmed characters. Records cannot change after insertion. N05 derives decision snapshots from the current active member and enforces subject authority and four eyes in the database.

## lessons

Small or big lesson text, status, source conversation ids, confirmation and approval metadata, version and update time. Members insert and update; workers insert. Text is mutable; revisions provide the history needed for Undo. Revision creation is an explicit workflow responsibility in later phases, not an automatic trigger in this phase.

## lesson_revisions

Versioned before and after text and status, optional changing member and event time. Members append. Records cannot change after insertion. A revision is unique per lesson and version.

## audit_events

Per-workspace sequence of actions, target, JSON payload and event-time actor snapshots linked with SHA256 hashes. Both roles append only through `append_audit`, which derives workspace and actor from context. Reads follow row security. Owner mutation and truncate attempts also fail with triggers enabled. See [the canonical chain format and verification limits](audit-chain.md).

## Administration commands

Use pnpm and Node 22. No script reads an env file. Supply the environment variables through the process environment; do not put credentials in command arguments or logs.

* `pnpm db:migrate` uses `DATABASE_URL_OWNER`, applies migrations, and prints only applied names and a count. It transpiles the dependency-free TypeScript runner in memory without a build.
* `pnpm db:roles` uses `DATABASE_URL_OWNER` and `NAZIR_APP_LOGIN_PASSWORD`. Run after migrations. It creates or updates `nazir_login`, strips direct Nazir privileges and other role memberships, and grants the two execution roles. It prints no credentials.
* `pnpm db:live-check` uses `DATABASE_URL` for `nazir_login`. It runs one transaction, reports PASS or FAIL for isolation, audit and immutability checks, and always rolls back. Any failure exits with status 1. It needs no owner URL.
* `pnpm test` runs PGlite in memory. `pnpm gate` runs lint, type checking, tests and production build. No remote database is required.

The health endpoint runs SELECT 1 through the lazy runtime pool with a three second limit. It returns only `up`, `down` or `not_configured` and never database error details. No UI is added by this phase.
