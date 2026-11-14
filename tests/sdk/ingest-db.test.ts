import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { keyHash } from '../../src/server/sdk/keys';

let db: TestDatabase;
let a: { member_id: string; workspace_id: string };
let b: { member_id: string; workspace_id: string };
const keyA = `nzk_${'a'.repeat(32)}_${'A'.repeat(40)}`;
const keyB = `nzk_${'b'.repeat(32)}_${'B'.repeat(40)}`;
const asAuth = <T extends Record<string, unknown>>(sql: string, params: unknown[]) => db.driver.transaction(async (c) => { await c.query('SET LOCAL ROLE nazir_auth'); return (await c.query<T>(sql, params)).rows; });
const span = (kind: string, turn = 1) => ({ kind, name: kind, turn, status: 'OK', attributes: { 'gen_ai.tool.name': 'create_case' } });
const ingest = (key: string, session: string, spans: unknown[]) => asAuth<{ n: number }>('SELECT nazir.ingest_spans($1,$2,$3::jsonb,$4) AS n', [keyHash(key), session, JSON.stringify(spans), '1.0.0']);

beforeAll(async () => {
  db = await testDatabase();
  a = await db.bootstrap('Sdk A'); b = await db.bootstrap('Sdk B');
  for (const w of [a, b]) {
    await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [w.workspace_id]);
    await db.member(w.member_id, (sql) => sql.query("SELECT nazir.save_external_agent($1::jsonb,NULL,NULL)", [JSON.stringify({ name: 'Agent', endpoint: 'https://agent.example.com/chat', format: 'simple_json' })]));
  }
  await db.member(a.member_id, (sql) => sql.query('SELECT nazir.issue_sdk_key($1,$2)', [keyHash(keyA), keyA.slice(-4)]));
  await db.member(b.member_id, (sql) => sql.query('SELECT nazir.issue_sdk_key($1,$2)', [keyHash(keyB), keyB.slice(-4)]));
});
afterAll(async () => { await db?.close(); });

it('accepts spans only for a session Nazir opened for the key owner, and marks the SDK connected on hello', async () => {
  const session = (await db.member(a.member_id, (sql) => sql.query<{ s: string }>("SELECT nazir.open_test_session('connect') AS s"))).rows[0]!.s;
  expect(session).toMatch(/^ses_[0-9a-f]{32}$/);
  await expect(ingest(keyB, session, [span('execute_tool')])).rejects.toThrow(/sdk_session/);
  expect((await ingest(keyA, session, [span('execute_tool'), span('nazir.hello'), span('nazir.turn.end')]))[0]!.n).toBe(3);
  const status = (await db.member(a.member_id, (sql) => sql.query<{ s: Record<string, unknown> }>('SELECT nazir.read_sdk_status() AS s'))).rows[0]!.s;
  expect(status).toMatchObject({ key_last4: 'AAAA', sdk_version: '1.0.0' });
  expect(status.sdk_seen_at).toBeTruthy();
  expect((await db.owner.query('SELECT connection_kind FROM nazir.external_agents WHERE workspace_id=$1', [a.workspace_id])).rows[0]).toEqual({ connection_kind: 'sdk' });
  // B never sees A's spans or sessions.
  expect((await db.member(b.member_id, (sql) => sql.query('SELECT * FROM nazir.trace_spans'))).rows).toHaveLength(0);
  expect((await db.member(b.member_id, (sql) => sql.query('SELECT * FROM nazir.test_sessions'))).rows).toHaveLength(0);
  expect((await db.member(a.member_id, (sql) => sql.query('SELECT * FROM nazir.trace_spans'))).rows).toHaveLength(3);
});

it('refuses a revoked key at once and an unknown key', async () => {
  const session = (await db.member(b.member_id, (sql) => sql.query<{ s: string }>("SELECT nazir.open_test_session('quality') AS s"))).rows[0]!.s;
  await db.member(b.member_id, (sql) => sql.query('SELECT nazir.revoke_sdk_key()'));
  await expect(ingest(keyB, session, [span('execute_tool')])).rejects.toThrow(/sdk_key/);
  await expect(ingest(`nzk_${'c'.repeat(32)}_${'C'.repeat(40)}`, session, [span('execute_tool')])).rejects.toThrow(/sdk_key/);
});

it('caps spans per session', async () => {
  const session = (await db.member(a.member_id, (sql) => sql.query<{ s: string }>("SELECT nazir.open_test_session('quality') AS s"))).rows[0]!.s;
  for (let i = 0; i < 5; i++) await ingest(keyA, session, Array.from({ length: 100 }, () => span('execute_tool')));
  await expect(ingest(keyA, session, [span('execute_tool')])).rejects.toThrow(/sdk_limit/);
});

it('lets the background runner open sessions only in its own workspace, and members cannot write spans directly', async () => {
  const s = (await db.worker(a.workspace_id, (sql) => sql.query<{ s: string }>("SELECT nazir.open_test_session('quality') AS s"))).rows[0]!.s;
  expect((await db.owner.query('SELECT workspace_id FROM nazir.test_sessions WHERE id=$1', [s])).rows[0]).toEqual({ workspace_id: a.workspace_id });
  await expect(db.member(a.member_id, (sql) => sql.query("INSERT INTO nazir.trace_spans(workspace_id,session_id,turn,kind,name) VALUES($1,$2,1,'execute_tool','x')", [a.workspace_id, s]))).rejects.toThrow(/permission denied/);
  await expect(db.member(a.member_id, (sql) => sql.query('SELECT key_hash FROM nazir.sdk_keys'))).rejects.toThrow(/permission denied/);
});

it('keeps the newest inventory and skips an unchanged one', async () => {
  const hash = 'f'.repeat(64);
  expect((await asAuth<{ c: boolean }>('SELECT nazir.ingest_inventory($1,$2,$3::jsonb) AS c', [keyHash(keyA), hash, JSON.stringify({ tools: [{ name: 'create_case' }], mcp_servers: [] })]))[0]!.c).toBe(true);
  expect((await asAuth<{ c: boolean }>('SELECT nazir.ingest_inventory($1,$2,$3::jsonb) AS c', [keyHash(keyA), hash, '{}']))[0]!.c).toBe(false);
  expect((await db.member(a.member_id, (sql) => sql.query<{ s: { tools: number } }>('SELECT nazir.read_sdk_status() AS s'))).rows[0]!.s.tools).toBe(1);
});

it('refuses keys and traces in a demo account, and deletes all traces on request', async () => {
  const demo = await db.bootstrap('Sdk demo');
  await expect(db.member(demo.member_id, (sql) => sql.query('SELECT nazir.issue_sdk_key($1,$2)', [keyHash('x'), 'xxxx']))).rejects.toThrow(/demo_connection/);
  const deleted = (await db.member(a.member_id, (sql) => sql.query<{ n: number }>('SELECT nazir.delete_traces() AS n'))).rows[0]!.n;
  expect(deleted).toBeGreaterThan(0);
  expect((await db.member(a.member_id, (sql) => sql.query('SELECT * FROM nazir.trace_spans'))).rows).toHaveLength(0);
});
