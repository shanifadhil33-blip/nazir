import { afterAll, beforeAll, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: () => {} }));
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { fixture } from '../runner/helpers';
import { saveExternalAgent, testExternalAgent } from '../../src/server/settings/external-agent';
import { approveSafetyFix, confirmSafety, safetyStep, startSafety, stopSafety } from '../../src/server/safety/run';
import { listSafety, readSafety } from '../../src/server/safety/read';

const resolve = async () => [{ address: '93.184.215.14' }];
let db: TestDatabase;
let demo: { ws: string; member: string }, real: { ws: string; member: string }, other: { ws: string; member: string };
async function ownerOf(ws: string) { return (await db.owner.query<{ id: string }>('SELECT id FROM nazir.members WHERE workspace_id=$1 ORDER BY created_at LIMIT 1', [ws])).rows[0]!.id; }
beforeAll(async () => {
  db = await testDatabase();
  const d = await fixture(db, 'Safety demo'), r = await fixture(db, 'Safety real'), o = await fixture(db, 'Safety other');
  await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=ANY($1::uuid[])", [[r.workspaceId, o.workspaceId]]);
  demo = { ws: d.workspaceId, member: await ownerOf(d.workspaceId) };
  real = { ws: r.workspaceId, member: await ownerOf(r.workspaceId) };
  other = { ws: o.workspaceId, member: await ownerOf(o.workspaceId) };
}, 60000);
afterAll(async () => { await db?.close(); });
async function drain(transport?: NonNullable<Parameters<typeof safetyStep>[1]>['transport']) {
  for (let i = 0; i < 40; i++) if (!(await safetyStep(db.driver, { transport, turnGapMs: 0 })).advanced) break;
}

it('demo: the sample finds its three planted weaknesses, and after the fixes it is Ready and safe', async () => {
  const { id } = await startSafety(db.driver, demo.member, 'demo');
  expect((await startSafety(db.driver, demo.member, 'demo')).id, 'one test at a time').toBe(id);
  await drain();
  const first = await readSafety(db.driver, demo.member, id);
  expect(first).toMatchObject({ status: 'done', scope: 'sample', verdict: 'not_ready' });
  const found = first.weaknesses.filter((w) => w.outcome === 'broken' || w.outcome === 'partial');
  expect(found.map((w) => w.family).sort()).toEqual(['S10', 'S2', 'S5']);
  expect(found.find((w) => w.family === 'S10')).toMatchObject({ severity: 'critical', proven: 'trace' });
  for (const w of found) await approveSafetyFix(db.driver, demo.member, w.family, 'demo');
  const again = await startSafety(db.driver, demo.member, 'demo');
  await drain();
  const second = await readSafety(db.driver, demo.member, again.id);
  expect(second.verdict).toBe('ready_safe');
  expect(second.weaknesses).toEqual([]);
  // Every step is in the audit log.
  const actions = (await db.owner.query<{ action: string }>("SELECT action FROM nazir.audit_events WHERE workspace_id=$1 AND action LIKE 'safety.%' ORDER BY seq", [demo.ws])).rows.map((r) => r.action);
  expect(actions).toEqual(expect.arrayContaining(['safety.started', 'safety.finished', 'safety.fix_approved']));
}, 120000);

it('your agent: needs the one time ownership confirm, talks only to the connected host and is judged from replies', async () => {
  await expect(startSafety(db.driver, real.member, 'real')).rejects.toMatchObject({ code: 'no_agent' });
  await saveExternalAgent(db.driver, real.member, { name: 'Desk', endpoint: 'https://agent.example.com/chat', format: 'simple_json' }, undefined, resolve);
  const hosts: string[] = [];
  const fetcher = (async (url: string | URL | Request) => { hosts.push(new URL(String(url instanceof Request ? url.url : url)).host); return Response.json({ reply: 'Sorry, I can only help with your own cases.' }); }) as typeof fetch;
  await testExternalAgent(db.driver, real.member, { message: 'Hi', language: 'en' }, { fetcher, resolve });
  await expect(startSafety(db.driver, real.member, 'real')).rejects.toMatchObject({ status: 409, code: 'safety_confirm_needed' });
  await confirmSafety(db.driver, real.member);
  expect((await db.owner.query('SELECT host FROM nazir.safety_confirmations WHERE workspace_id=$1', [real.ws])).rows).toEqual([{ host: 'agent.example.com' }]);
  const { id } = await startSafety(db.driver, real.member, 'real');
  hosts.length = 0;
  await drain({ fetcher, resolve });
  expect(new Set(hosts)).toEqual(new Set(['agent.example.com']));
  const done = await readSafety(db.driver, real.member, id);
  expect(done).toMatchObject({ status: 'done', scope: 'replies_only', verdict: 'replies_clean' });
  expect(done.weaknesses.find((w) => w.family === 'S10')).toMatchObject({ outcome: 'not_run', reason: 'test_people' });
  // Two a day.
  await startSafety(db.driver, real.member, 'real').then(({ id: second }) => stopSafety(db.driver, real.member, second));
  await expect(startSafety(db.driver, real.member, 'real')).rejects.toMatchObject({ status: 429, code: 'safety_daily_limit' });
}, 120000);

it('pauses after five errors in a row instead of hammering your agent', async () => {
  await saveExternalAgent(db.driver, other.member, { name: 'Down', endpoint: 'https://down.example.com/chat', format: 'simple_json' }, undefined, resolve);
  let up = true;
  const fetcher = (async () => { if (up) return Response.json({ reply: 'Hello' }); throw new Error('connection refused'); }) as typeof fetch;
  await testExternalAgent(db.driver, other.member, { message: 'Hi', language: 'en' }, { fetcher, resolve });
  await confirmSafety(db.driver, other.member);
  const { id } = await startSafety(db.driver, other.member, 'real');
  up = false;
  await drain({ fetcher, resolve });
  const run = (await db.owner.query<{ status: string; errors_in_row: number }>('SELECT status,errors_in_row FROM nazir.safety_runs WHERE id=$1', [id])).rows[0]!;
  expect(run.status).toBe('paused');
  expect(run.errors_in_row).toBeGreaterThanOrEqual(5);
  expect((await db.owner.query("SELECT count(*)::int AS n FROM nazir.safety_attempts WHERE run_id=$1 AND status='queued'", [id])).rows[0]!.n).toBeGreaterThan(0);
}, 120000);

it('keeps every safety table to its own workspace', async () => {
  for (const table of ['safety_runs', 'safety_attempts', 'safety_fixes', 'safety_confirmations']) {
    await db.member(other.member, async (sql) => {
      expect((await sql.query(`SELECT * FROM nazir.${table} WHERE workspace_id=ANY($1::uuid[])`, [[demo.ws, real.ws]])).rows, table).toHaveLength(0);
    });
    await expect(db.member(other.member, (sql) => sql.query(`INSERT INTO nazir.${table}(workspace_id) VALUES($1)`, [real.ws])), table).rejects.toThrow();
  }
  expect((await listSafety(db.driver, other.member, 'real')).runs.every((r) => r.agent === 'Down')).toBe(true);
  await expect(readSafety(db.driver, other.member, (await listSafety(db.driver, real.member, 'real')).runs[0]!.id)).rejects.toThrow();
  await expect(approveSafetyFix(db.driver, real.member, 'S2', 'real')).rejects.toMatchObject({ code: 'own_agent' });
  await expect(db.member(real.member, (sql) => sql.query("SELECT nazir.safety_fix_approve('S2')"))).rejects.toThrow(/sample agent/);
}, 60000);
