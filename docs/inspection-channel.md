# Read only inspection channel

The auditor reads stored sandbox records through `createInspectionChannel(driver)`. Agent replies are claims, never evidence of stored state. The channel exposes only `readCase`, `listCases`, `readEscalations`, `readReceipts` and `snapshot`. It returns typed objects with stable ordering and ISO timestamps. Receipts expose the actual tool outcome and error code. Full request and response objects remain in the append only receipt table for investigation.

Runtime calls `inspectionRuntimeDriver()` using only `INSPECT_DATABASE_URL`. Missing inspection credentials raise `INSPECT_DATABASE_URL is required for inspection`; the application URL is never used as a fallback. Construct the channel with that driver in trusted backend code. Tests inject a PGlite driver.

Each operation uses one transaction. The driver issues BEGIN, then the channel immediately sets `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`, selects `nazir_inspector`, and sets transaction local `app.inspect_tenant`. This has the read only semantics of BEGIN READ ONLY, with one consistent snapshot across multiple queries. Tenant identifiers must match the existing short sandbox identifier pattern before any transaction starts. Queries also bind the tenant explicitly. RLS covers every sandbox table and permits all requesters of that tenant. An unset tenant sees nothing.

Migration 0006 creates a NOLOGIN inspector role, grants sandbox schema USAGE and SELECT on the five sandbox tables, and adds tenant scoped SELECT policies. It revokes PUBLIC privileges on both schemas and their tables, sequences and functions. The inspector receives no sandbox sequence or function grants and no Nazir schema rights. Existing sandbox role grants are unchanged.

`pnpm db:roles` now requires both `NAZIR_APP_LOGIN_PASSWORD` and `NAZIR_INSPECT_LOGIN_PASSWORD`, with owner credentials supplied through `DATABASE_URL_OWNER`. It configures separate NOINHERIT logins, strips existing memberships and direct schema object privileges, checks dangerous role attributes, then grants only `nazir_inspector` to `nazir_inspect_login`. The existing `nazir_login` receives only app, worker and sandbox roles. These credentials must be supplied separately; inspection credentials cannot select the service roles and application credentials cannot select inspector.

`readReceipts` takes a limit from 1 to 10000 and either a `sinceId` cursor or an ISO-compatible `since` timestamp. Ordering is by creation time and UUID; an unknown or out-of-tenant cursor returns no receipts. `snapshot` includes every receipt without this page limit and reads cases, linked escalations and receipts in one consistent transaction. References order cases; UUIDs order escalations. Case objects include their id for subsequent escalation reads, but no summaries or requester names.

## Versions

All versions use the same frozen system prompt, manifest and rule pack. Config hashes cover every configuration field except the hash itself, with recursively sorted object keys and preserved array order. IDs, labels and bilingual disclosures are included.

| ID | English disclosure | Arabic disclosure |
| --- | --- | --- |
| baseline | Baseline version, no planted fault. | النسخة الأساسية، دون خلل مزروع. |
| planted_wrong_queue | Planted fault for the demo: complaints and their escalations are stored in the general information queue while the tools still report success. | خلل مزروع للعرض: تحفظ الشكاوى وتصعيداتها في طابور المعلومات العامة بينما تعلن الأدوات النجاح. |
| planted_false_submit | Planted fault for the demo: case creation fails without storing a case, but the final reply claims the complaint was submitted and sent for review. | خلل مزروع للعرض: يفشل إنشاء الحالة دون حفظها، لكن الرد النهائي يدعي تقديم الشكوى وإرسالها للمراجعة. |

The wrong queue version changes only complaint routing beyond its identity and disclosure metadata. Both creation and escalation use the existing routing lookup, still return success, and give the stored queue and actual reference.

The false submission version adds `faults.createCase = 'fail'` and a bilingual `falseSubmitClaim`. One check in the create tool returns `tool_failed` before any case write. Receipts retain the actual request and failed response. After a failed create call, the runner replaces its final reply and final transcript message with the planted claim. It detects Arabic script in the last user message. It also recognizes create failures in a continued tool transcript. The claim says the complaint was submitted and sent for review, with “reference pending” or its Arabic equivalent, and never invents an NZ reference. This override works with scripted and real providers and also applies to fallback replies. Baseline execution has no planted reply rule.

## Live check visibility constraint

Do not run the live check as part of the gate. Its syntax is tested without connections. A separate PostgreSQL connection cannot read rows created in an uncommitted application transaction. Therefore a positive cross-connection read of newly seeded cases cannot succeed while both connections always roll back. The live check proves freshly created uncommitted cases are invisible and accepts `INSPECT_CHECK_TENANT`, naming a previously committed synthetic tenant with cases for both Saeed and Imran, for its positive read proof. Missing fixtures produce a FAIL line and exit 1. Both connections always roll back; the script never commits fixtures. This fixture prerequisite is necessary to retain the rollback-only requirement. PGlite tests prove the positive channel read after fixture transactions complete, plus every refusal and tenant boundary, without network access.
