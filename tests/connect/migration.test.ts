import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { testDatabase } from '../helpers/pglite';
it('0038 preserves existing API connections, tested timestamps, grants and FORCE RLS without new tables', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nazir-0038-'));
  try {
    for (const file of await readdir('db/migrations')) if (file.endsWith('.sql') && file < '0038') await copyFile(join('db/migrations', file), join(root, file));
    const db = await testDatabase(root);
    try {
      const a = await db.bootstrap('Before connections');
      await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [a.workspace_id]);
      await db.member(a.member_id, (sql) => sql.query("SELECT nazir.save_external_agent($1::jsonb,NULL,NULL)", [JSON.stringify({ name: 'Old agent', endpoint: 'https://agent.example.com/chat', format: 'simple_json' })]));
      const before = (await db.owner.query<{ revision: string }>('SELECT revision FROM nazir.external_agents WHERE workspace_id=$1', [a.workspace_id])).rows[0]!;
      await db.member(a.member_id, (sql) => sql.query('SELECT nazir.external_agent_tested($1)', [before.revision]));
      const tables = (await db.owner.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname IN ('nazir','sandbox')")).rows[0];
      await db.owner.query(await readFile('db/migrations/0038_connections.sql', 'utf8'));
      expect((await db.owner.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname IN ('nazir','sandbox')")).rows[0]).toEqual(tables);
      expect((await db.member(a.member_id, (sql) => sql.query<{ view: unknown }>('SELECT nazir.read_external_agent() AS view'))).rows[0]!.view).toMatchObject({ name: 'Old agent', ready: true, connection_kind: 'api', tested_at: expect.any(String) });
      await db.member(a.member_id, (sql) => sql.query("SELECT nazir.save_external_agent($1::jsonb,NULL,NULL)", [JSON.stringify({ name: 'Changed agent', endpoint: 'https://agent.example.com/changed', format: 'simple_json' })]));
      expect((await db.member(a.member_id, (sql) => sql.query<{ ok: boolean }>('SELECT nazir.external_agent_tested($1) AS ok', [before.revision]))).rows[0]!.ok).toBe(false);
      expect((await db.owner.query('SELECT tested_at,connection_kind FROM nazir.external_agents WHERE workspace_id=$1', [a.workspace_id])).rows[0]).toEqual({ tested_at: null, connection_kind: 'api' });
      expect((await db.owner.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='nazir.external_agents'::regclass")).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      for (const role of ['nazir_app', 'nazir_worker', 'nazir_sandbox', 'nazir_inspector']) expect((await db.owner.query('SELECT rolname FROM pg_roles WHERE rolname=$1', [role])).rows).toHaveLength(1);
      await expect(db.member(a.member_id, (sql) => sql.query('SELECT key_cipher FROM nazir.external_agents'))).rejects.toThrow(/permission denied/);
      const other = await db.bootstrap('Other connection');
      expect((await db.member(other.member_id, (sql) => sql.query('SELECT nazir.read_external_agent() AS s'))).rows[0]!.s).toBeNull();
    } finally { await db.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
