# SDK 1.0.1

Download the new Node or Python file from Full check setup and send a test message after replacing it. The shown SHA256 matches the released file. Version 1.0.0 remains available unchanged for existing installations. Full safety tests for observed connected tools require at least 1.0.1 and link directly to setup when an older wrapper is seen.

Node `wrapMcp(client, { name, tools })` and Python `wrap_mcp(client, name, tools)` leave unsigned real traffic alone. A valid signed test blocks any tool whose safety is not configured. Declare read tools explicitly with `changesData: false` in Node or `changes_data=False` in Python. A locally supplied `annotations: { readOnlyHint: true }` is also supported. These are your own configuration choices; remote metadata alone never changes the wrapper's containment.

Changing tools require a dry run to produce a test result. Without one they return a blocked result, record what would have happened and never call the real implementation. Read tools treat returned content as outside text by default, so signed tests can inject into the actual MCP `content` array without modifying the original response. Python also supports validated model objects without importing a particular MCP package. Metadata includes the server for every tool call. Unknown real-traffic tool names never accumulate in the exported map.

The SDK masks its own key and bearer-shaped credentials in output strings. A boolean trace flag lets Nazir report a detected exposure without storing the value. Collector scrubbing for arbitrary test-login values is a separate remaining task; this release does not claim that complete.

Removing Test people now aborts an in-flight S10 control and prevents the next authenticated turn. Editing the setup continues to use the run's frozen original identities.

Public `mcp-legacy` and `mcp-contained` sample modes exercise setup and the version guard with a read-only in-memory client. They perform no real external MCP writes. The legacy mode uses the unchanged 1.0.0 file; the contained mode uses 1.0.1. They are staging fixtures, not customer infrastructure.
