# Nazir (ناظر)

Nazir is an agent that tests government service AI agents in Arabic and English. It checks what an agent really did in the records, not only what it said.

It is specific to one domain on purpose: government service assistants, starting with complaints. It can expand into other areas once the domain knowledge and funding are in place.

Live app: https://nazir-liard.vercel.app (sign in with Google; the demo workspace uses synthetic people and cases).

## What works today (Oct 20 2026)
- Chat first workspace: agent log, score, failures sheet, report, in English and Arabic, phone and laptop.
- Runner with clean synthetic tenants, record checks, a reply judge on free providers, findings, repairs with another member's approval, rechecks, version comparison, memory of lessons.
- Agent settings: name, instructions, language, avatar, MCP servers callable from chat (writes need another member's approval), the owner's own model key (sealed, last 4 shown).
- Report: "Measured from saved runs", nine numbers, each with what it was counted from.
- Live test (demo workspaces): type a complaint, flip the planted fault switch, see clean and faulty versions side by side. It needs the inspection channel and free provider keys in the deploy; without them it says so and queues nothing.

## Not yet
- The live test is not connected in production yet (keys are the owner's decision).
- Measured results come from a small number of runs so far; the numbers will change.
- Arabic is Modern Standard Arabic and has not had a native review.

Notes: docs/runner.md, docs/findings.md, docs/repair.md, docs/memory.md, docs/compare.md, docs/n20-n24-report.md, docs/live-test.md.

## Develop

Use Node 22.

```sh
pnpm install
pnpm gate
```
