import { afterAll, beforeAll, expect, it } from 'vitest';
import { createAuthAdapter } from '../../src/server/auth/adapter';
import { ensureHomeWorkspace } from '../../src/server/auth/workspaces';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); });
afterAll(async () => { await db?.close(); });

it('seeds the home workspace once on the real schema, readable by the owner under row level security', async () => {
  // Same path as sign in: the Auth.js adapter creates the user.
  const user = await createAuthAdapter(() => db.driver).createUser!({ id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: 'Saeed', image: null, emailVerified: null });
  const first = await ensureHomeWorkspace(db.driver, user.id);
  expect(await ensureHomeWorkspace(db.driver, user.id)).toBe(first);
  const concurrent = await Promise.all([ensureHomeWorkspace(db.driver, user.id), ensureHomeWorkspace(db.driver, user.id)]);
  expect(concurrent).toEqual([first, first]);

  const count = async (query: string) => (await db.owner.query<{ n: number }>(query, [first])).rows[0]!.n;
  expect((await db.owner.query('SELECT id FROM nazir.workspaces WHERE created_by=$1', [user.id])).rows).toEqual([{ id: first }]);
  expect((await db.owner.query('SELECT name FROM nazir.agents WHERE workspace_id=$1', [first])).rows).toEqual([{ name: 'Fictional Service Agent' }]);
  expect(await count('SELECT count(*)::int AS n FROM nazir.agent_versions WHERE workspace_id=$1')).toBe(1);
  expect((await db.owner.query('SELECT kind FROM nazir.agent_versions WHERE workspace_id=$1', [first])).rows).toEqual([{ kind: 'baseline' }]);
  expect((await db.owner.query('SELECT focus_pack FROM nazir.agent_settings WHERE workspace_id=$1', [first])).rows).toEqual([{ focus_pack: 'government' }]);
  expect(await count("SELECT count(*)::int AS n FROM nazir.audit_events WHERE workspace_id=$1 AND action='workspace.seeded'")).toBe(1);

  // The owner's own session sees all of it under row level security.
  const memberId = (await db.owner.query<{ id: string }>('SELECT id FROM nazir.members WHERE workspace_id=$1 AND user_id=$2', [first, user.id])).rows[0]!.id;
  const seen = await db.member(memberId, async (sql) => ({
    agents: (await sql.query('SELECT name FROM nazir.agents')).rows,
    versions: (await sql.query('SELECT kind FROM nazir.agent_versions')).rows,
    settings: (await sql.query("SELECT nazir.read_agent_settings()->>'focus_pack' AS focus_pack")).rows,
    audit: (await sql.query("SELECT action FROM nazir.audit_events WHERE action='workspace.seeded'")).rows,
  }));
  expect(seen).toEqual({
    agents: [{ name: 'Fictional Service Agent' }], versions: [{ kind: 'baseline' }],
    settings: [{ focus_pack: 'government' }], audit: [{ action: 'workspace.seeded' }],
  });
});
