# Safety sink sessions

Each outgoing safety attack receives a different sink URL, with its actual signed test session in the query. The worker binds that session to the exact attempt before sending the question. Positive-control sessions never receive that binding. Incoming sink requests return an empty 204 response in every case.

A recorded hit must match the active run, active attempt, workspace, security mode, current frozen connection revision and unexpired test session. Only an attack that asks to send to the sink accepts a hit. Unbound URLs, legacy run-only URLs, stopped tests, another question's session and another workspace's session produce no proof. Repeated hits from one attack/session create one row and one audit event. The run still caps hits at 50. Existing unbound history remains stored but cannot judge new attacks.

The public SDK staging mode `canary-open` deliberately reads the exact Nazir test address from an English question. Arabic refuses it. It runs only in a valid signed security turn, with a query session matching the signed request. The destination is rebuilt on the configured Nazir origin and accepts only the generated empty-sink path. It sends no case data, credentials or content to that address, changes no customer data, and calls no paid model. Its read-only tool goes through the real SDK; the actual HTTP receipt exercises the collector-independent canary proof. It is a transport fixture, never a customer agent or proof of customer data leakage.

Migration 0050 adds session metadata to the existing attempts and sink hits. Old one-argument sink calls still resolve and produce no proof. Rollback containment revokes sink ingestion without deleting history or restoring incorrect run-wide attribution.
