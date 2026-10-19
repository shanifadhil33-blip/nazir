import { execFileSync } from 'node:child_process';
import { expect,it } from 'vitest';
it.each(['scripts/runner-fixture.mjs','scripts/runner-run.mjs','scripts/runner-loader.mjs'])('%s parses without execution', (file) => {
  expect(() => execFileSync(process.execPath,['--check',file])).not.toThrow();
});
