import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);
import { existsSync } from 'node:fs';
import { expect,it } from 'vitest';
it.each(['scripts/runner-fixture.mjs','scripts/runner-run.mjs','scripts/runner-loader.mjs','scripts/runner-library-fixture.mjs','scripts/judge-calibrate.mjs','scripts/findings-probe.mjs','scripts/live-helpers.mjs','scripts/repair-cycle.mjs','scripts/memory-check.mjs','scripts/compare-versions.mjs','scripts/workspace-live-check.mjs'])('%s parses without execution', async (file) => {
  await expect(execFile(process.execPath,['--check',file])).resolves.toHaveProperty('stderr', '');
});

const runnerNode = existsSync('/home/box/.local/node22/bin/node')
  ? '/home/box/.local/node22/bin/node'
  : process.execPath;
const hasRegisterHooks = (await execFile(runnerNode, ['-e',
  "console.log(typeof require('node:module').registerHooks)",
], { encoding: 'utf8' })).stdout.trim() === 'function';

it.skipIf(!hasRegisterHooks)('loads TypeScript pack runtimes with JSON imports through the runner loader', async () => {
  const output = await execFile(runnerNode, ['--input-type=module', '-e',
    'import("./scripts/runner-loader.mjs").then(()=>import("./src/server/packs/runtime.ts")).then(m=>console.log(m.packRuntimes.map(r=>r.id).join(",")))',
  ], { encoding: 'utf8' });
  expect(output.stdout.trim()).toBe('real_estate,ecommerce,clinics,schools');
});

it.skipIf(!hasRegisterHooks)('resolves quick data through the actual runner loader without a database or providers', async () => {
  const output = await execFile(runnerNode, ['--input-type=module', '-e',
    'import("./scripts/runner-loader.mjs").then(()=>import("./src/server/packs/quick.ts")).then(async q=>{const {focusPacks}=await import("./src/server/packs/catalog.ts"); console.log(focusPacks.map(p=>q.selectSize(p.id,p.quick.keys.map(stable_key=>({stable_key,language:stable_key.endsWith("_ar")?"ar":"en"})),q.planSize.parse(process.env.SIZE)).length).join(","))})',
  ], { encoding: 'utf8', env: { ...process.env, SIZE: 'quick' } });
  expect(output.stdout.trim()).toBe('8,8,8,8,8');
});
