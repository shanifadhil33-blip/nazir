import { execFileSync } from 'node:child_process';
import { expect,it } from 'vitest';
it.each(['scripts/runner-fixture.mjs','scripts/runner-run.mjs','scripts/runner-loader.mjs','scripts/runner-library-fixture.mjs','scripts/judge-calibrate.mjs','scripts/findings-probe.mjs','scripts/live-helpers.mjs','scripts/repair-cycle.mjs','scripts/memory-check.mjs','scripts/compare-versions.mjs'])('%s parses without execution', (file) => {
  expect(() => execFileSync(process.execPath,['--check',file])).not.toThrow();
});
