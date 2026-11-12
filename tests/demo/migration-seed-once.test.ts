import { mkdtemp, readdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { testDatabase, seed } from '../helpers/pglite';
import { installDemoLibrary } from '../../src/server/demo/library';
import { demoWorkspaceId } from '../../src/server/auth/demo';

it('upgrades duplicate legacy seeds once and cancels only demo runs older than one hour', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nazir-chunk0-'));
  try {
    const migration = '0036_demo_seed_once.sql';
    for (const name of await readdir('db/migrations')) {
      if (name.endsWith('.sql') && name < migration) await copyFile(join('db/migrations', name), join(root, name));
    }
    const db = await testDatabase(root);
    try {
      await installDemoLibrary(db.driver, db.driver);
      await db.owner.query('SELECT nazir.demo_seed()');
      await db.owner.query('ALTER TABLE nazir.reports DISABLE TRIGGER report_frozen');
      await db.owner.query("UPDATE nazir.reports SET created_at=created_at-interval '4 days'");
      await db.owner.query('ALTER TABLE nazir.reports ENABLE TRIGGER report_frozen');
      await db.owner.query('SELECT nazir.demo_seed()');
      expect((await db.owner.query('SELECT id FROM nazir.reports WHERE workspace_id=$1', [demoWorkspaceId])).rows).toHaveLength(4);
      const real = await seed(db, 'Imran');
      await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [real.workspace_id]);
      const source = (await db.owner.query<{ id: string }>('SELECT id FROM nazir.runs WHERE workspace_id=$1 LIMIT 1', [demoWorkspaceId])).rows[0]!.id;
      const run = async (source: string, age: string) => (await db.owner.query<{ id: string }>(`INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,status,created_at)
        SELECT workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version,'queued',clock_timestamp()-$2::interval FROM nazir.runs WHERE id=$1 RETURNING id`, [source, age])).rows[0]!.id;
      const demoOld = await run(source, '61 minutes');
      const demoFresh = await run(source, '59 minutes');
      const realOld = await run(real.ids.runs!, '61 minutes');
      const audit = (await db.owner.query('SELECT * FROM nazir.audit_events ORDER BY workspace_id,seq')).rows;
      await db.owner.query(await readFile(join('db/migrations', migration), 'utf8'));
      const statuses = (await db.owner.query<{ id: string; status: string }>('SELECT id,status FROM nazir.runs WHERE id=ANY($1::uuid[])', [[demoOld, demoFresh, realOld]])).rows;
      expect(statuses.find((r) => r.id === demoOld)?.status).toBe('cancelled');
      expect(statuses.find((r) => r.id === demoFresh)?.status).toBe('queued');
      expect(statuses.find((r) => r.id === realOld)?.status).toBe('queued');
      expect((await db.owner.query("SELECT id FROM nazir.runs WHERE workspace_id=$1 AND idempotency_key LIKE 'demo-seed-%'", [demoWorkspaceId])).rows).toHaveLength(2);
      expect((await db.owner.query('SELECT id FROM nazir.reports WHERE workspace_id=$1', [demoWorkspaceId])).rows).toHaveLength(2);
      expect((await db.owner.query('SELECT id FROM nazir.proposals WHERE workspace_id=$1', [demoWorkspaceId])).rows).toHaveLength(2);
      expect((await db.owner.query("SELECT body->>'sample' AS sample FROM nazir.reports WHERE workspace_id=$1", [demoWorkspaceId])).rows).toEqual([{ sample: 'true' }, { sample: 'true' }]);
      const after = (await db.owner.query('SELECT * FROM nazir.audit_events ORDER BY workspace_id,seq')).rows;
      for (const row of audit) expect(after.find((r) => r.workspace_id === row.workspace_id && r.seq === row.seq)).toEqual(row);
      // Even an owner-supplied flag does not open real report deletion.
      await db.owner.query("SELECT set_config('app.demo_seed_cleanup','on',false)");
      await expect(db.owner.query('DELETE FROM nazir.reports WHERE workspace_id=$1', [real.workspace_id])).rejects.toThrow(/cannot change/);
    } finally { await db.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60000);
