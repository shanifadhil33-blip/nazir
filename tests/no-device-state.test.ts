import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

it('keeps nothing a person needs on the device: every screen reads the server', () => {
  const offenders = files('src').filter((file) => /\b(localStorage|sessionStorage)\b/.test(readFileSync(file, 'utf8')));
  expect(offenders).toEqual([]);
});
