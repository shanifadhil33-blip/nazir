import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';

let db: TestDatabase;
let a: Awaited<ReturnType<typeof seed>>;
let b: Awaited<ReturnType<typeof seed>>;
let tables: string[];
beforeAll(async () => {
  db = await testDatabase();
  a = await seed(db, 'A'); b = await seed(db, 'B');
  // AI state has no direct role grants; tests/ai/store.test.ts checks its function-only access.
  tables = (await db.owner.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='nazir' AND tablename NOT IN ('ai_usage','ai_cooldowns','ai_calls','auth_accounts','auth_sessions','library_fix_usage','agent_settings') ORDER BY tablename")).rows.map((r) => r.tablename);
});
afterAll(async () => { await db?.close(); });
it('enables and forces RLS with workspace policies on every table', async () => {
  const rows = (await db.owner.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nazir' AND c.relkind='r'")).rows;
  expect(rows).toHaveLength(37);
  expect(tables).toHaveLength(30);
  for (const row of rows) { expect(row.relrowsecurity).toBe(true); expect(row.relforcerowsecurity).toBe(true); }
  expect((await db.owner.query("SELECT * FROM pg_policies WHERE schemaname='nazir' AND policyname='workspace'")).rows).toHaveLength(tables.length);
});
it('separates A and B across every populated tenant table and global users', async () => {
  for (const table of tables) {
    const column = table === 'workspaces' ? 'id' : 'workspace_id';
    if (table === 'users') continue;
    expect((await db.owner.query(`SELECT * FROM nazir.${table} WHERE ${column}=$1`, [b.workspace_id])).rows.length, table).toBeGreaterThan(0);
    await db.member(a.member_id, async (sql) => {
      expect((await sql.query(`SELECT * FROM nazir.${table} WHERE ${column}=$1`, [b.workspace_id])).rows, table).toHaveLength(0);
      expect((await sql.query(`SELECT * FROM nazir.${table} WHERE ${column}=$1`, [a.workspace_id])).rows.length, table).toBeGreaterThan(0);
    });
  }
  await db.member(a.member_id, async (sql) => {
    expect((await sql.query('SELECT email FROM nazir.users')).rows).toEqual([{ email: 'a@example.test' }]);
  });
});
it('rejects inserts targeting B for every tenant table', async () => {
  for (const table of tables.filter((t) => !['users', 'workspaces'].includes(t))) {
    const row = (await db.owner.query<{ row: Record<string, unknown> }>(`SELECT to_jsonb(t) AS row FROM nazir.${table} t WHERE workspace_id=$1 LIMIT 1`, [b.workspace_id])).rows[0]!.row;
    if ('id' in row) row.id = randomUUID();
    await expect(db.member(a.member_id, (sql) => sql.query(`INSERT INTO nazir.${table} SELECT (jsonb_populate_record(NULL::nazir.${table},$1::jsonb)).*`, [JSON.stringify(row)])), table).rejects.toThrow(/row-level security|permission denied/);
  }
});
it('cannot update B rows in any table with an UPDATE grant', async () => {
  const writable = ['rule_packs', 'rule_pack_versions', 'agents', 'agent_versions', 'adapters', 'scenario_meanings', 'scenarios', 'plans', 'findings', 'proposals', 'lessons'];
  for (const table of writable) {
    const col = table === 'findings' ? 'status' : 'id';
    await db.member(a.member_id, async (sql) => {
      expect((await sql.query(`UPDATE nazir.${table} SET ${col}=${col} WHERE workspace_id=$1 RETURNING *`, [b.workspace_id])).rows).toHaveLength(0);
    });
  }
});
it('rejects a cross workspace parent through the composite foreign key', async () => {
  await expect(db.member(a.member_id, (sql) => sql.query("INSERT INTO nazir.rule_pack_versions(workspace_id,rule_pack_id,version,content) VALUES($1,$2,55,'{}')", [a.workspace_id, b.ids.rule_packs]))).rejects.toThrow(/foreign key/);
});
it('fails closed without a member context and after removal', async () => {
  await db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_app');
    expect((await sql.query('SELECT * FROM nazir.workspaces')).rows).toHaveLength(0);
  });
  await expect(db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_app');
    await sql.query("INSERT INTO nazir.rule_packs(workspace_id,key,title) VALUES($1,'no_context','test')", [a.workspace_id]);
  })).rejects.toThrow(/row-level security/);
  await db.owner.query("UPDATE nazir.members SET status='removed' WHERE id=$1", [a.member_id]);
  await db.member(a.member_id, async (sql) => {
    for (const table of tables) expect((await sql.query(`SELECT * FROM nazir.${table}`)).rows, table).toHaveLength(0);
  });
  await expect(db.member(a.member_id, (sql) => sql.query("SELECT nazir.append_audit('test',null,null,'{}')"))).rejects.toThrow('Workspace context required');
  await db.owner.query("UPDATE nazir.members SET status='active' WHERE id=$1", [a.member_id]);
});
it('requires SET ROLE for a login with NOINHERIT', async () => {
  await db.owner.query('CREATE ROLE test_login LOGIN NOINHERIT; GRANT nazir_app,nazir_worker TO test_login');
  await expect(db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE test_login');
    await sql.query('SELECT * FROM nazir.workspaces');
  })).rejects.toThrow(/permission denied/);
});
it('limits worker reads and writes to its workspace', async () => {
  await db.worker(a.workspace_id, async (sql) => {
    for (const table of tables.filter((t) => !['users', 'workspaces'].includes(t))) {
      expect((await sql.query(`SELECT * FROM nazir.${table} WHERE workspace_id=$1`, [b.workspace_id])).rows, table).toHaveLength(0);
    }
  });
  await expect(db.worker(a.workspace_id, (sql) => sql.query("INSERT INTO nazir.lessons(workspace_id,text,scope,created_by_type) VALUES($1,'bad','small','nazir')", [b.workspace_id]))).rejects.toThrow(/row-level security/);
  await db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_worker');
    expect((await sql.query('SELECT * FROM nazir.workspaces')).rows).toHaveLength(0);
  });
});
it('gives neither app role DELETE privileges on any table', async () => {
  expect((await db.owner.query("SELECT * FROM information_schema.role_table_grants WHERE grantee IN ('nazir_app','nazir_worker') AND privilege_type='DELETE'")).rows).toHaveLength(0);
});
it('bootstraps only as worker with an owner member and audit event', async () => {
  await expect(db.member(a.member_id, (sql) => sql.query("SELECT * FROM nazir.bootstrap_workspace('x@example.test','X','X','demo')"))).rejects.toThrow(/permission denied/);
  const c = await db.bootstrap('C');
  expect((await db.owner.query('SELECT role FROM nazir.member_roles WHERE member_id=$1', [c.member_id])).rows).toEqual([{ role: 'service_owner' }]);
  expect((await db.owner.query('SELECT action FROM nazir.audit_events WHERE workspace_id=$1', [c.workspace_id])).rows).toEqual([{ action: 'workspace.created' }]);
  const same = await db.bootstrap('C');
  expect(same.workspace_id).not.toBe(c.workspace_id);
  expect((await db.owner.query("SELECT * FROM nazir.users WHERE email='c@example.test'")).rows).toHaveLength(1);
});
