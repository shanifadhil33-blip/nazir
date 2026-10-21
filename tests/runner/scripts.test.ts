import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect,it } from 'vitest';
it.each(['scripts/runner-fixture.mjs','scripts/runner-run.mjs','scripts/runner-loader.mjs','scripts/runner-library-fixture.mjs','scripts/judge-calibrate.mjs','scripts/findings-probe.mjs','scripts/live-helpers.mjs','scripts/repair-cycle.mjs','scripts/memory-check.mjs','scripts/compare-versions.mjs','scripts/workspace-live-check.mjs'])('%s parses without execution', (file) => {
  expect(() => execFileSync(process.execPath,['--check',file])).not.toThrow();
});

const runnerNode = existsSync('/home/box/.local/node22/bin/node')
  ? '/home/box/.local/node22/bin/node'
  : process.execPath;
const hasRegisterHooks = execFileSync(runnerNode, ['-e',
  "console.log(typeof require('node:module').registerHooks)",
], { encoding: 'utf8' }).trim() === 'function';

it.skipIf(!hasRegisterHooks)('loads TypeScript pack runtimes with JSON imports through the runner loader', () => {
  const output = execFileSync(runnerNode, ['--input-type=module', '-e',
    'import("./scripts/runner-loader.mjs").then(()=>import("./src/server/packs/runtime.ts")).then(m=>console.log(m.packRuntimes.map(r=>r.id).join(",")))',
  ], { encoding: 'utf8' });
  expect(output.trim()).toBe('real_estate,ecommerce,clinics,schools');
});
