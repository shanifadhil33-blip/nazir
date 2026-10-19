#!/bin/bash
# Usage: run-phase.sh <phase-name>   (prompt at prompts/<phase>.md, report and log beside it)
phase="$1"
export PATH=/home/box/.local/node22/bin:$PATH
cd /workspace/nazir
P=/workspace/nazir/prompts
for attempt in 1 2 3; do
  /home/box/.local/bin/codex exec -C /workspace/nazir -s workspace-write -c sandbox_workspace_write.network_access=true -o "$P/$phase-report.md" - < "$P/$phase.md" > "$P/$phase.log" 2>&1
  if grep -qi "usage limit" "$P/$phase.log" && [ ! -s "$P/$phase-report.md" ]; then echo "USAGE_LIMIT attempt $attempt"; break; else break; fi
done
echo CODEX_DONE
