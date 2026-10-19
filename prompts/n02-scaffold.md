# Nazir phase N02: repo scaffold and gate (Codex task)

You are working in /workspace/nazir, a PRIVATE repo for Nazir (Arabic ناظر), an agent that tests government service AI agents in Arabic and English. Right now it only has README.md and .gitignore. Your job is the project scaffold and the quality gate. No product screens.

## Environment rules (must follow)
- Start EVERY shell command with: export PATH=/home/box/.local/node22/bin:$PATH && ...
  Check once that `node --version` prints v22.
- Package manager: pnpm 10.34.6 ("packageManager": "pnpm@10.34.6"). If the pnpm store in the home folder is blocked by the sandbox, add an .npmrc with store-dir, cache-dir and state-dir inside the repo (.pnpm-store, .pnpm-cache, .pnpm-state) and make sure .gitignore covers all three.
- Do not git commit, do not git push, do not run vercel. I review and commit.
- Do not touch anything outside /workspace/nazir. You may READ /workspace/soldline for patterns (it is the team's reference project) but NEVER modify it.
- No secrets in the repo. No .env files committed. Do not read /workspace/nazir-secrets or /workspace/secrets.

## Build this
1. Next.js 16 (App Router, `src/app`), React 19, TypeScript with "strict": true (plus "noUncheckedIndexedAccess": true), ESLint 9 flat config with eslint-config-next (core web vitals + typescript), Vitest 3. Use the same versions as /workspace/soldline/package.json where they overlap. Path alias `@/*` to `./src/*`. Add `"engines": {"node": ">=22"}`.
2. package.json scripts: dev, start, lint (`eslint .`), typecheck (`tsc --noEmit`), test (`vitest run`), build (`next build`), gate (`node scripts/gate.mjs`).
3. scripts/gate.mjs: runs pnpm lint, typecheck, test, build in order with stdio inherit; stops at the first failing step and exits with that step's exit code (signal or spawn error = exit 1). Copy the pattern of /workspace/soldline/scripts/gate.mjs, and the test /workspace/soldline/tests/gate.test.ts (fake pnpm on PATH, checks stop order and exit code). Its temp folder `.gate-audit*` must be in .gitignore and ESLint ignores.
4. vercel.json with {"framework": "nextjs"} (the Vercel project was created by the CLI and may default to Other).
5. next.config.ts: poweredByHeader false and the same security headers as Soldline (HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, CSP with frame-ancestors 'none', base-uri 'self', object-src 'none', form-action 'self' https://accounts.google.com).
6. Pages (plain and minimal, NO design work, no colours beyond black text on #FFFFFF, system font stack, readable 16px body, max width about 42rem, no cards, no gradients, no icons):
   - `/` placeholder: heading "Nazir", Arabic name ناظر shown with lang="ar" dir="rtl", one line: "Nazir tests government service AI agents in Arabic and English. It checks the real records, not only what the agent says." Then the banner line in both languages: "Fictional service and synthetic cases. No live government connection." and «خدمة افتراضية وحالات اختبار مصطنعة. لا يوجد اتصال مباشر بنظام حكومي.» Links to Privacy and Terms. Nothing else.
   - `/privacy` and `/terms`: public, static, plain true copy for a prototype that only uses fictional services and synthetic test data. Say: it never connects to any real government system; do not enter real personal data; test conversations may be processed by free third party AI model providers, so only synthetic data is used; sign in with Google is used only to identify the account (name, email, picture) when sign in is added; data is kept in a Postgres database hosted by Neon and the app on Vercel; results are within tested scope only and are not a certificate; contact: adhil+bilal@mail.grokbot.com. Last updated 19 October 2026. Model the structure on /workspace/soldline/src/app/(public)/privacy and terms but write new Nazir text. Never use the words certified, compliant, approved by, government endorsed, guaranteed, fully safe.
   - Root `not-found.tsx`, `error.tsx` (client, with Try again and Back to home) and `global-error.tsx`: plain text versions, no framework defaults, no headers()/cookies()/auth in root boundaries so static pages still prerender.
   - Root layout: lang="en", metadata title "Nazir", description in plain words without dashes. Simple `icon.svg` (a plain dark circle with a light letter N is fine; no sparkle).
   - Mark /, /privacy, /terms as static (`export const dynamic = 'force-static'`).
7. API: `src/app/api/health/route.ts` GET returning JSON {"ok": true, "service": "nazir", "commit": first 7 chars of process.env.VERCEL_GIT_COMMIT_SHA or null}, with `Cache-Control: no-store`. No database access yet. No error details ever.
8. Copy tests (team rules; copy the approach of /workspace/soldline/tests/helpers/source.ts, no-dash.test.ts, no-jargon.test.ts, no-ai-look.test.ts):
   - tests/helpers/source.ts: TypeScript AST scan of visible string literals, JSX text and template text in src/**/*.ts(x) plus all JSON string values under messages/ (create messages/en.json and messages/ar.json with the few strings above so the folder exists; pages may import them). Code literals (imports, className, href, ids, URLs, object keys) are skipped.
   - tests/no-dash.test.ts: rejects " - ", en dash and em dash in visible copy, with unit cases both ways, and a final test over the whole app.
   - tests/no-jargon.test.ts: banned words list for user facing copy: dispatch, synergy, leverage, orchestrate, orchestration, seamless, cutting edge, revolutionary, game changer, robust, empower, unlock, copilot, AI employee, LLM, guardrails, deterministic, certified, compliant, guaranteed, fully safe, government endorsed. Word boundary match, case insensitive, unit cases both ways, then the whole app.
   - tests/no-ai-look.test.ts: same rules as Soldline (no Sparkles/Sparkle/WandSparkles/Wand2/Stars icon imports incl. aliases and namespace use, no ✨, no bg-gradient, no gradient text, no blur-2xl/3xl glow, no uppercase+tracking eyebrow) plus inline style checks for `linear-gradient`/`radial-gradient` and `backdrop-filter` in .tsx and .css files under src.
   - tests/no-optional-copy.test.ts: the word "optional" must not appear in visible copy (team rule: extras are never labelled optional).
   - tests/gate.test.ts as in point 3.
   - tests/pages.test.tsx: render /, /privacy, /terms server components to static markup (react-dom/server renderToStaticMarkup) and assert: the banner text in English and Arabic is on the home page, privacy and terms each have a heading and the contact address, the Arabic text sits in an element with dir="rtl" and lang="ar".
   - tests/health.test.ts: the health route returns ok true, no-store, commit null without the env and 7 chars with it.
9. README.md: keep the existing text, add a short "Develop" section: Node 22, pnpm install, pnpm gate. Plain words, no dashes in prose.
10. .gitignore: keep the existing lines, add .pnpm-store/, .pnpm-cache/, .pnpm-state/, .gate-audit*/, tsconfig.tsbuildinfo already covered by *.tsbuildinfo.

## Acceptance (run these yourself before you finish)
- `pnpm install` then `pnpm gate` passes end to end (lint, typecheck, test, build all green). Paste the final test count and build route table in your report.
- `pnpm build` shows /, /privacy, /terms as static and /api/health as dynamic.
- No file outside /workspace/nazir changed. No secrets anywhere.

## Report
Finish with a short report: files created, test files and counts, gate result, anything you could not do and why.
