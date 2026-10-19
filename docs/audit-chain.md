# Audit chain format

The chain is tamper evident against a kept manifest. It is not tamper proof. A database owner can disable triggers, rewrite rows and recompute hashes. Keep a trusted export of each workspace's last sequence and hash outside the database, along with the run manifest. Compare that checkpoint as well as verifying the chain. Verification alone cannot detect removal of a suffix, an entire chain, or a fully rewritten chain without that checkpoint.

SQL `nazir.audit_canonical` and TypeScript `auditCanonical` use this fixed field order:

1. workspace_id as lowercase UUID text
2. seq as base 10 bigint text
3. at as UTC `YYYY-MM-DD"T"HH24:MI:SS.US"Z"` with exactly six fractional digits
4. actor_type
5. actor_member_id as UUID text
6. actor_name_at_event
7. actor_roles_at_event joined with commas, in stored order
8. action
9. target_type
10. target_id
11. payload as PostgreSQL `jsonb::text`
12. prev_hash

Join the fields with one U+001F character, with no trailing separator. Null scalar fields become empty strings. Empty roles become an empty string. Member roles are sorted alphabetically at insertion. Hash the UTF8 bytes with SHA256 and store lowercase hexadecimal. The first prev_hash is 64 ASCII zeroes. The format has no escaping: preserve stored strings exactly, including any separator characters. The fixed field boundaries come from the stored row, not from parsing the canonical text. Do not use the canonical string as an unambiguous independent serialization for signatures or new protocols.

`readAuditChain` returns `seq`, timestamp and payload as SQL text. Do not pass JSON parsed and serialized again in JavaScript, or a JavaScript Date: those can change JSON spacing, numeric precision or timestamp microseconds. Sequence numbers remain strings to preserve bigint precision. `brokenAt` is also a sequence string. Verification requires the complete chain for one workspace in ascending sequence order, starting at 1; an empty chain returns count 0. It checks sequence, previous link, then hash, in that order.

The insert trigger locks a workspace-specific advisory key for the transaction, ignores supplied sequence, timestamp and hash fields, and fills them itself. Hash-key collisions can serialize unrelated workspaces but cannot merge their sequences. Member display name and roles are copied at event time. Worker events use actor type `nazir`. The audit function derives workspace context itself and app roles have no direct insert grant. Row mutation and statement truncate triggers reject changes even for the owner while enabled.

PGlite uses a single connection and queues concurrent transactions. Tests exercise independent sequences and parallel queued appends; actual simultaneous PostgreSQL connections are outside the local test environment.
