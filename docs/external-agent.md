# Connect an external agent

An owner opens Agent settings, then Connect your agent. Save the public HTTPS chat endpoint and select its request format. An auth header and secret can be supplied when needed. To replace the secret, enter a new value. To remove it, clear the header name and save. A successful test message activates the connection for subsequent quick checks and full runs. Removing the connection restores the built in target for new runs.

Supported contracts:

* `openai_chat`: POST `{messages:[{role:"user"|"assistant",content:string}]}` and read `choices[0].message.content`. The link must point to the complete chat endpoint; Nazir adds no path or model field.
* `simple_json`: POST `{message,session_id,language}` and read `{reply}`. The same session ID is reused throughout one test conversation. Language is `en` or `ar`.

Only resident messages and earlier replies reach the external endpoint. Nazir does not send its sandbox instructions, tools, knowledge, or judge prompts to that endpoint. Auth secrets use the existing AES GCM sealing mechanism and require the server's existing `AUTH_SECRET`. Clients see only a saved indicator and the final four characters. Other workspace members see the name, host and readiness. Saves, test sends and removal require `service_owner` both at the route and in database functions.

Calls use HTTPS on port 443, reject URL credentials and nonpublic DNS addresses, check DNS at save and before every call, refuse redirects, enforce a ten second deadline including response reads, and read at most 65536 response bytes. Extracted replies are plain text capped at 8000 characters. Exact auth secret echoes are redacted before evidence or judge input. Endpoint failures expose fixed bilingual errors rather than response bodies or exception details. Test sends have a persistent rolling limit of 20 per workspace per hour, including failed attempts, across owners and connection changes.

Runs pin the connection revision. Saving or removing it prevents pending conversations of that revision from switching target or falling back to the sandbox. The external adapter never invokes sandbox tools or reads sandbox records. Record checks are inconclusive with the reason “Not checked: external agent has no records link”. The chosen pack rubric and owner knowledge still score replies as untrusted data. External model family independence cannot be verified and is marked in semantic results. A supported reply cannot turn missing record checks into an overall pass; a contradicted reply can produce a failure and a semantic finding.

Migration `0030_external_agent.sql` adds function only access with forced workspace RLS and audit events that contain no connection configuration or secrets. It is supplied unapplied. The test suite applies migrations only to disposable in memory PGlite databases; no deployment or real database migration is part of this feature's verification.
