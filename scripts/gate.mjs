import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const steps = ['lint', 'typecheck', 'test', 'build'];

export function runGate(run = spawnSync) {
  for (const step of steps) {
    const result = run('pnpm', [step], { stdio: 'inherit' });
    if (result.error || result.signal || result.status === null) return 1;
    if (result.status !== 0) return result.status;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runGate());
}
