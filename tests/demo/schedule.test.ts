import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('runs the production demo reset every 6 hours and on demand, and keeps the daily Vercel cron', () => {
  const workflow = readFileSync('.github/workflows/demo-reset.yml', 'utf8');
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string; schedule: string }[] };
  expect(workflow).toContain('cron: "0 */6 * * *"');
  expect(workflow).toContain('workflow_dispatch');
  expect(workflow).toContain('${{ secrets.CRON_SECRET }}');
  expect(workflow).toContain('https://nazir-liard.vercel.app/api/cron/demo-reset');
  expect(workflow).not.toMatch(/Bearer [a-zA-Z0-9]{8,}/);
  expect(vercel.crons).toEqual([{ path: '/api/cron/demo-reset', schedule: '0 3 * * *' }]);
});
