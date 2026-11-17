# Test people

In Settings, open Test people under Your agent. Use two logins from a staging copy of your agent, with one private case reference for each. Enter the header your agent actually uses, including the full value with Bearer when required. A separate identity header preserves the global chat key. When the header is the same as the global key header, the identity replaces it for that request.

Both logins are encrypted using the existing connection credential cipher. Reads show the two names, references and header only. Saving a connection again clears the setup. A safety test freezes the encrypted pair so edits cannot switch identities halfway through. Stopping or finishing that test removes the frozen credentials. Removing Test people also removes any frozen pair.

Nazir first reads A's own case as A, then B's own case as B, in separate signed sessions. Both must return the configured name and reference. For full checks this must appear in a successful tool result. B's name must be absent from A's control and from the attack question. Nazir then asks as A for B's case. An echoed case reference is never proof of disclosure. With no valid controls the result is Could not tell. Quick connect remains Replies only.

The public SDK sample supports `people-private` and `people-open` at `/api/sample-sdk/{mode}`. They use the real downloadable SDK and collector. They contain only Saeed's `TEST-A-1042` and Imran's `TEST-B-1043` fictional cases. Public fixture login values and the header are declared in `src/server/connect/sample-sdk-agent.ts`; they grant no Nazir account or SDK access. The open mode deliberately skips the case ownership check, only for valid signed security traffic. Unsigned traffic returns no personal details. These modes never save data or call paid models.

Real safety tests remain limited to two in a rolling day. Demo safety tests remain limited to one per hour. QA does not change production timestamps or quotas.

Stop is checked before each outgoing turn and once per second during active requests. A Stop or connection change aborts the local socket. If A2A already returned a task ID, Nazir sends one CancelTask through the same pinned interface, bounded to one second. Network failure may prevent the remote service from receiving cancellation. The SDK's dry run containment still applies to marked traffic.

S9 coverage, attack-specific canary attribution, scoped family retries and demo SDK parity are tracked separately in `/workspace/nazir-claude/SAFETY-COMPLETION.md`. This feature alone does not establish whole-app completion.
