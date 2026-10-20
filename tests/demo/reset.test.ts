import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { Forbidden } from '../../src/server/http/errors';
import { demoCap, resetDemoNow, resetDemosDue } from '../../src/server/demo/reset';

let db: TestDatabase;
let demoId: string;
let owner: string;
let realId: string;
beforeAll(async () => {
  db = await testDatabase();
  const demo = await db.bootstrap('Tariq');
  demoId = demo.workspace_id;
  owner = demo.member_id;
  const real = await db.bootstrap('Faisal');
  realId = real.workspace_id;
  await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [realId]);
  await db.createMember(demoId, ['quality_reviewer'], 'Khalid Hamdan');
}, 60000);
afterAll(async () => { await db?.close(); });

async function clock() {
  return (await db.owner.query<{ now: string }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
}
async function putStore(workspaceId: string, note: string, age: string) {
  return (await db.owner.query<{ id: string; bytes: number; created_at: string }>(`INSERT INTO nazir.demo_store(workspace_id,payload,created_at) VALUES($1,$2::jsonb,clock_timestamp()-($3::interval)) RETURNING id,bytes,created_at`, [workspaceId, JSON.stringify({ note }), age])).rows[0]!;
}

it('recycles the oldest demo rows down to the cap and leaves a real workspace alone', async () => {
  const oldest = await putStore(demoId, 'oldest payload', '3 hours');
  const middle = await putStore(demoId, 'middle payload', '2 hours');
  const newest = await putStore(demoId, 'newest payload', '1 hour');
  const cap = newest.bytes;
  const removed = await resetDemoNow(db.driver, owner, demoId, cap, new Date(await clock()));
  expect(removed.removed).toBeGreaterThan(0);
  const left = (await db.owner.query<{ id: string }>('SELECT id FROM nazir.demo_store WHERE workspace_id=$1 ORDER BY created_at', [demoId])).rows.map((row) => row.id);
  expect(left).toEqual([newest.id]);
  expect(left).not.toContain(oldest.id);
  expect(left).not.toContain(middle.id);
  const thread = (await db.owner.query<{ id: string }>('INSERT INTO nazir.agent_threads(workspace_id,member_id) VALUES($1,$2) RETURNING id', [realId, (await db.owner.query<{ id: string }>('SELECT id FROM nazir.members WHERE workspace_id=$1 AND display_name=$2', [realId, 'Faisal'])).rows[0]!.id])).rows[0]!.id;
  await db.owner.query("INSERT INTO nazir.agent_messages(workspace_id,thread_id,seq,role,body,created_at) VALUES($1,$2,1,'member','Keep this note.',clock_timestamp())", [realId, thread]);
  await expect(db.owner.query("INSERT INTO nazir.demo_store(workspace_id,payload) VALUES($1,'{\"note\":\"no\"}')", [realId])).rejects.toThrow(/not a demo/);
  const reviewer = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.members WHERE display_name='Khalid Hamdan'")).rows[0]!.id;
  const realOwner = (await db.owner.query<{ id: string }>("SELECT id FROM nazir.members WHERE workspace_id=$1 AND display_name='Faisal'", [realId])).rows[0]!.id;
  await expect(resetDemoNow(db.driver, reviewer, demoId, cap)).rejects.toBeInstanceOf(Forbidden);
  await expect(resetDemoNow(db.driver, realOwner, realId, cap)).rejects.toThrow(/not a demo/);
  expect((await db.owner.query('SELECT id FROM nazir.agent_messages WHERE workspace_id=$1', [realId])).rows).toHaveLength(1);
});
it('runs on a 6 hour schedule and again only after that window', async () => {
  const start = await clock();
  const first = (await resetDemosDue(db.driver, 50, new Date(start))).find((row) => row.workspaceId === demoId)!;
  expect(first.removed).toBeGreaterThanOrEqual(0);
  const logs = async () => Number((await db.owner.query<{ n: number }>("SELECT count(*)::int AS n FROM nazir.demo_reset_log WHERE workspace_id=$1 AND reason='schedule'", [demoId])).rows[0]!.n);
  const afterFirst = await logs();
  const soon = (await db.owner.query<{ t: string }>("SELECT ($1::timestamptz + interval '1 hour') AS t", [start])).rows[0]!.t;
  const second = (await resetDemosDue(db.driver, 50, new Date(soon))).find((row) => row.workspaceId === demoId)!;
  expect(second.removed).toBe(0);
  expect(await logs()).toBe(afterFirst);
  const later = (await db.owner.query<{ t: string }>("SELECT ($1::timestamptz + interval '7 hours') AS t", [start])).rows[0]!.t;
  await resetDemosDue(db.driver, 50, new Date(later));
  expect(await logs()).toBe(afterFirst + 1);
});
it('keeps sign in usable through a reset', async () => {
  const definition = (await db.owner.query<{ def: string }>("SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='nazir' AND p.proname='demo_recycle'")).rows[0]!.def;
  expect(definition).toContain('SKIP LOCKED');
  expect(definition).toContain('lock_timeout');
  expect(definition).not.toMatch(/auth_sessions|auth_accounts|nazir\.users/);
  const token = 'cd'.repeat(32);
  const hash = createHash('sha256').update(token).digest('hex');
  const user = await db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_auth');
    return (await sql.query<{ id: string }>("SELECT id FROM nazir.auth_create_user('omar@example.test','Omar Mansoor',null)")).rows[0]!;
  });
  await db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_auth');
    await sql.query('SELECT * FROM nazir.auth_create_session($1,$2,clock_timestamp()+interval \'1 day\')', [hash, user.id]);
  });
  await resetDemoNow(db.driver, owner, demoId, 80, new Date(await clock()));
  const session = await db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_auth');
    return (await sql.query('SELECT user_data FROM nazir.auth_read_session($1)', [hash])).rows[0];
  });
  expect(session).toBeTruthy();
  await db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_auth');
    const created = await sql.query('SELECT token_hash FROM nazir.auth_create_session($1,$2,clock_timestamp()+interval \'1 day\')', ['ef'.repeat(32), user.id]);
    expect(created.rows).toHaveLength(1);
  });
  expect((await db.owner.query("SELECT action FROM nazir.audit_events WHERE workspace_id=$1 AND action='demo.reset'", [demoId])).rows.length).toBeGreaterThan(0);
});
it('reads the storage cap from the environment', () => {
  expect(demoCap({})).toBe(262144);
  expect(demoCap({ DEMO_STORAGE_CAP_BYTES: '1000' })).toBe(1000);
  expect(() => demoCap({ DEMO_STORAGE_CAP_BYTES: 'nope' })).toThrow(/Invalid storage cap/);
});
