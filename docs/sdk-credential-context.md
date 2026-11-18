# Trace credential privacy

The collector validates the active SDK key, exact session, current connection revision and active safety question before opening any encrypted credentials. Every new safety control and attack carries the same run and question ancestry with its own session. Old unbound security sessions are refused. Quality and connection sessions retain their existing behavior while rejecting uploads after a connection change.

Only the server ingest role can request this encrypted context. The server decrypts and masks its SDK key, the connection login, and the frozen test-person logins for S10 in the same transaction that saves the spans. Exact values, bare bearer values, nested strings and JSON escapes are masked before length limits. Fields and names are included. The public response contains only an accepted count. A boolean records an exposure without retaining the value, including flags already produced by SDK 1.0.1.

The transaction holds the credential rows through masking and storage. Removal or connection change either completes first and causes refusal, or waits until the upload is safely masked. Run completion, Stop, expired sessions, removed test logins and revoked keys reject subsequent security uploads. Credentials are never retained as a redaction tombstone. The underlying storage function is private to the database function owner.

The public `people-echo` fixture exercises this with the actual downloadable SDK and collector. It returns only its own two fictional staging logins in signed security tool results, while refusing the other person's case. It never reflects arbitrary caller credentials. The report can therefore prove a masked login exposure independently of a cross-person case leak.

This change concerns trace ingestion. It does not imply that arbitrary remote SDK implementations are trustworthy, or that the remaining MCP, instruction-fingerprint, scoped-test and demo-pipeline work is complete.
