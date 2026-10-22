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

it.skipIf(!hasRegisterHooks)('resolves quick data through the actual runner loader without a database or providers', () => {
  const output = execFileSync(runnerNode, ['--input-type=module', '-e',
    'import("./scripts/runner-loader.mjs").then(()=>import("./src/server/packs/quick.ts")).then(async q=>{const {focusPacks}=await import("./src/server/packs/catalog.ts"); console.log(focusPacks.map(p=>q.selectSize(p.id,p.quick.keys.map(stable_key=>({stable_key,language:stable_key.endsWith("_ar")?"ar":"en"})),q.planSize.parse(process.env.SIZE)).length).join(","))})',
  ], { encoding: 'utf8', env: { ...process.env, SIZE: 'quick' } });
  expect(output.trim()).toBe('16,16,16,16,16');
});
