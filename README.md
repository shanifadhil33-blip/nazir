# Nazir (ناظر)

Nazir is an agent that tests government service AI agents in Arabic and English.

It is specific to one domain on purpose: government service assistants. It can expand into other areas once the domain knowledge and funding are in place.

Status: backend in progress (N02 to N17 built: rule packs, sandbox, inspection channel, free AI chain, runner, record checks, test library, reply review, findings, repairs, memory and version comparison). No screens yet; screens come after the approved design.

Backend notes: docs/runner.md, docs/findings.md, docs/repair.md, docs/memory.md, docs/compare.md.

## Develop

Use Node 22.

```sh
pnpm install
pnpm gate
```
