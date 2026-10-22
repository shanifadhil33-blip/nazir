# Baseline KB facts report

Checked against `/home/box/shared/adhil/championship/nazir/kb-research/merged/{real_estate,ecommerce,clinics,schools}.md`, verified 22 October 2026.

The four sandbox policies now supply the published facts for all 23 new KB scenarios (46 English/Arabic cases). Policy tools return the same bilingual clauses, and system prompts allow answers from those supplied facts while requiring records for record-specific claims.

- Real estate: all Decree 43 slabs and boundary examples, Smart Rental Index, 90 day renewal notice, listed eviction grounds, cousin exclusion, 12 months formal notice, RDC referral, and AED 177.75 / AED 220 Ejari totals. Published explanations are distinguished from actual rulings.
- Ecommerce: Saudi seven day rescission and more than 15 days late cancellation, UAE marketing hours, identity, consent, refusal and frequency restrictions. The existing fictional store's 14 day window remains explicitly store policy, never a UAE statutory right. Marketing replies must not add unrelated return offers or deadlines.
- Clinics: attendance confidentiality, verified portal access, treatment advertising limits, AI and licensed professional boundaries, compassionate emergency guidance for self harm, and facility/regulator complaint routes.
- Schools: Dubai jurisdiction, application and deposit caps, offer prerequisite, re registration arithmetic, 40% / 30% / 30% payments, 10 calendar day withdrawal after fee increase, withdrawal date, arrears process and exam access, and school/KHDA dispute routing.

The four pack rubrics advance to version 1.1 and explicitly allow published facts with a dispute referral, while still rejecting missing facts and actual rulings. Ecommerce also distinguishes store policy from statutory rights. Planted fault definitions and operational tool behavior are unchanged.

Files changed (20 including this report):

- `src/sandbox/real-estate/{agent,policy,tools}.ts`
- `src/sandbox/shop/{agent,policy,tools}.ts`
- `src/sandbox/clinic/{agent,policy,tools}.ts`
- `src/sandbox/school/{agent,policy,tools}.ts`
- `src/server/packs/real-estate/pack.json`
- `src/server/packs/ecommerce/pack.json`
- `src/server/packs/clinics/pack.json`
- `src/server/packs/schools/pack.json`
- `tests/sandbox/kb-policy.test.ts` (new)
- `tests/packs/pack-runner.test.ts` (rubric version expectations)
- `tests/runner/external-agent.test.ts` (rubric version expectation)
- `prompts/baseline-kb-facts-report.md` (this report)

Validation: final Node v22.23.4 `pnpm gate` passed (exit 0): lint, typecheck, 90 test files with 1,456 tests passed and two skipped (1,458 total), and production build including Next type checking. The sandbox-only preload described below was required: the plain gate compiled but failed because captured Node subprocess output was empty when Next parsed TypeScript `--showConfig`. Existing dynamic filesystem tracing warnings remain nonfatal. Added 32 tests: 23 scenario fact checks covering both language variants, four policy tool checks using an in-memory stub, four judge prompt checks, and one bilingual safeguard against inventing a UAE 14 day statutory right. Existing planted fault tests remain in the full suite.

No live model run or real external call was made. No commits, operational migrations, deployments, secret files, `~/.codex`, or `next.config.ts` changes. Gate database tests use their existing in-memory test fixtures.

Sandbox build workaround (no repository config changes): the final gate uses Node v22.23.4 with a temporary preload selecting the documented `experimental.useTypeScriptCli: false` compiler API mode. Type checking remains enabled both in the standalone gate step and the production build. See `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/useTypeScriptCli.md`.

```sh
PATH=/tmp/node-v22.23.4-linux-x64/bin:$PATH \
NODE_OPTIONS=--require=/tmp/nazir-next-typescript-api.cjs pnpm gate
```

The temporary preload contains:

```js
const { defaultConfig } = require('/workspace/nazir/node_modules/next/dist/server/config-shared.js');
defaultConfig.experimental.useTypeScriptCli = false;
```
