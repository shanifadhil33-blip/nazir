import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createAuthAdapter, authCall } from '../../src/server/auth/adapter';
import { createWorkspace, ensureHomeWorkspace } from '../../src/server/auth/workspaces';
import type { TransactionDriver } from '../../src/server/db/driver';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); });
afterAll(async () => { await db?.close(); });
async function newUser() {
  return createAuthAdapter(() => db.driver).createUser!({ id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: 'Saeed', image: null, emailVerified: null });
}

it('creates exactly one real workspace across concurrent and repeated calls', async () => {
  const user = await newUser();
  const queries = vi.fn();
  const driver: TransactionDriver = {
    transaction: (work) => db.driver.transaction((sql) => work({
      query: (text, params) => { queries(text, params); return sql.query(text, params); },
    })),
  };
  const ids = await Promise.all([ensureHomeWorkspace(driver, user.id), ensureHomeWorkspace(driver, user.id)]);
  expect(ids[0]).toBe(ids[1]);
  expect(await ensureHomeWorkspace(driver, user.id)).toBe(ids[0]);
  expect(queries).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`home_workspace:${user.id}`]);
  expect(queries.mock.calls.filter(([sql]) => sql.includes('nazir.auth_create_workspace'))).toHaveLength(1);
  expect((await db.owner.query('SELECT id,name,kind FROM nazir.workspaces WHERE created_by=$1', [user.id])).rows)
    .toEqual([{ id: ids[0], name: 'My workspace', kind: 'real' }]);
});

it('sets up the Government Focus Pack and the built in sample agent exactly once, as the new owner', async () => {
  const user = await newUser();
  const first = await ensureHomeWorkspace(db.driver, user.id);
  expect(await ensureHomeWorkspace(db.driver, user.id)).toBe(first);
  const [again] = await Promise.all([ensureHomeWorkspace(db.driver, user.id), ensureHomeWorkspace(db.driver, user.id)]);
  expect(again).toBe(first);
  const owner = (await db.owner.query<{ id: string }>('SELECT id FROM nazir.members WHERE workspace_id=$1', [first])).rows;
  expect(owner).toHaveLength(1);
  expect((await db.owner.query('SELECT name FROM nazir.agents WHERE workspace_id=$1', [first])).rows).toEqual([{ name: 'Fictional Service Agent' }]);
  expect((await db.owner.query('SELECT kind,config,created_by FROM nazir.agent_versions WHERE workspace_id=$1', [first])).rows)
    .toEqual([{ kind: 'baseline', config: { registry_id: 'baseline' }, created_by: owner[0]!.id }]);
  expect((await db.owner.query('SELECT focus_pack,name,language FROM nazir.agent_settings WHERE workspace_id=$1', [first])).rows)
    .toEqual([{ focus_pack: 'government', name: null, language: 'en' }]);
  expect((await db.owner.query("SELECT count(*)::int AS n FROM nazir.audit_events WHERE workspace_id=$1 AND action='workspace.seeded'", [first])).rows[0]).toEqual({ n: 1 });
  // An existing workspace is never seeded again on a later sign in.
  await db.owner.query('DELETE FROM nazir.agent_settings WHERE workspace_id=$1', [first]);
  await ensureHomeWorkspace(db.driver, user.id);
  expect((await db.owner.query('SELECT count(*)::int AS n FROM nazir.agent_settings WHERE workspace_id=$1', [first])).rows[0]).toEqual({ n: 0 });
});

it('prefers a workspace the user owns over one they only belong to', async () => {
  const user = await newUser();
  const member = await createWorkspace(db.driver, user.id, { name: 'Member workspace' });
  const owner = await createWorkspace(db.driver, user.id, { name: 'Owner workspace' });
  await db.owner.query("DELETE FROM nazir.member_roles WHERE member_id=$1 AND role='service_owner'", [member.memberId]);
  expect(await ensureHomeWorkspace(db.driver, user.id)).toBe(owner.workspaceId);
  await db.owner.query('DELETE FROM nazir.member_roles WHERE member_id=$1', [owner.memberId]);
  expect([member.workspaceId, owner.workspaceId]).toContain(await ensureHomeWorkspace(db.driver, user.id));
});

it('never returns shared library or demo workspaces without an active membership for this user', async () => {
  const library = await db.bootstrap('Nazir library fixture');
  const demo = await db.bootstrap('Shared demo');
  const other = await newUser();
  const otherWorkspace = await createWorkspace(db.driver, other.id, { name: 'Another user workspace' });
  const user = await newUser();
  const removed = await createWorkspace(db.driver, user.id, { name: 'Removed membership' });
  await db.owner.query("UPDATE nazir.members SET status='removed' WHERE id=$1", [removed.memberId]);
  const home = await ensureHomeWorkspace(db.driver, user.id);
  expect([library.workspace_id, demo.workspace_id, otherWorkspace.workspaceId, removed.workspaceId]).not.toContain(home);
  expect(await authCall(db.driver, 'auth_memberships', [user.id], user.id)).toEqual([
    expect.objectContaining({ workspaceId: home, workspaceName: 'My workspace', kind: 'real', roles: ['service_owner'] }),
  ]);
});

it('allows a demo workspace only when the user has their own active membership', async () => {
  const demo = await db.bootstrap('Member demo');
  const user = await newUser();
  await db.owner.query('INSERT INTO nazir.members(workspace_id,user_id,display_name) VALUES($1,$2,$3)', [demo.workspace_id, user.id, user.name]);
  expect(await ensureHomeWorkspace(db.driver, user.id)).toBe(demo.workspace_id);
  expect((await db.owner.query('SELECT id FROM nazir.workspaces WHERE created_by=$1', [user.id])).rows).toEqual([]);
});
