import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('keeps Checks start, stop and progress on the server', () => {
  for (const file of ['checks-run.ts', 'checks-screen.tsx']) {
    const source = readFileSync(`src/components/shell/${file}`, 'utf8');
    expect(source, file).not.toContain('sessionStorage');
    expect(source, file).not.toMatch(/\/step[\x27\x22`]/);
  }
  const source = readFileSync('src/components/shell/checks-screen.tsx', 'utf8');
  const startAndProgress = source.slice(0, source.indexOf('  async function suggest'));
  expect(startAndProgress).not.toContain('localStorage');
  expect(startAndProgress).not.toContain("method: 'POST', headers: { 'content-type'");
});
