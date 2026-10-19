Implemented the scaffold, plain pages, health API, security headers, gate script, bilingual messages, configs, and lockfile. Preserved existing README and `.gitignore` content and added the requested entries.

`pnpm install` and `pnpm gate` passed: lint, typecheck, tests, and production build.

**7 test files, 78 tests passed:**

| Test file | Tests |
|---|---:|
| no-dash | 8 |
| no-jargon | 29 |
| no-ai-look | 23 |
| no-optional-copy | 5 |
| gate | 7 |
| pages | 4 |
| health | 2 |

Final build route table:

```text
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/health
├ ○ /icon.svg
├ ○ /privacy
└ ○ /terms

○ Static
ƒ Dynamic
```

Nothing remains blocked. All writes stayed inside `/workspace/nazir`. No secrets were added; existing `.env.local` and `prompts/` were untouched. No commit, push, or Vercel command was run.