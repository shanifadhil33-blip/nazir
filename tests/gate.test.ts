import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const steps = ['lint', 'typecheck', 'test', 'build'];

function auditGate(failureStep: string, failureCode: number, mode: 'exit' | 'signal' | 'missing' = 'exit') {
  const directory = mkdtempSync(join(process.cwd(), '.gate-audit'));
  try {
    const log = join(directory, 'calls.jsonl');
    const executable = join(directory, 'pnpm');
    writeFileSync(executable, `#!${process.execPath}\n` +
      'const fs = require("node:fs");\n' +
      'const step = process.argv[2];\n' +
      'fs.appendFileSync(process.env.GATE_AUDIT_LOG, JSON.stringify(step) + "\\n");\n' +
      'if (step === process.env.GATE_FAIL_STEP && process.env.GATE_FAIL_MODE === "signal") process.kill(process.pid, "SIGTERM");\n' +
      'process.exit(step === process.env.GATE_FAIL_STEP ? Number(process.env.GATE_FAIL_CODE) : 0);\n');
    chmodSync(executable, 0o755);
    if (mode === 'missing') rmSync(executable);
    const result = spawnSync(process.execPath, ['scripts/gate.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: mode === 'missing' ? directory : `${directory}:${process.env.PATH}`, GATE_AUDIT_LOG: log,
        GATE_FAIL_MODE: mode, GATE_FAIL_STEP: failureStep, GATE_FAIL_CODE: String(failureCode) },
    });
    const called = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
    return { code: result.status, called };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it.each(steps)('Stops when %s fails and preserves its exit code', (step) => {
  const result = auditGate(step, 7);
  expect(result.code).toBe(7);
  expect(result.called).toEqual(steps.slice(0, steps.indexOf(step) + 1));
});
it('Runs every step in order when all pass', () => {
  expect(auditGate('', 0)).toEqual({ code: 0, called: steps });
});

it('Exits with one and stops after a signalled step', () => {
  expect(auditGate('typecheck', 0, 'signal')).toEqual({ code: 1, called: ['lint', 'typecheck'] });
});
it('Exits with one when pnpm cannot spawn', () => {
  expect(auditGate('', 0, 'missing')).toEqual({ code: 1, called: [] });
});
