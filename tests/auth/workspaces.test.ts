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

it('prefers the oldest owner workspace, falling back to the oldest membership', async () => {
  const user = await newUser();
  const oldest = await createWorkspace(db.driver, user.id, { name: 'Oldest member workspace' });
  const owner = await createWorkspace(db.driver, user.id, { name: 'Oldest owner workspace' });
  const newest = await createWorkspace(db.driver, user.id, { name: 'Newest owner workspace' });
  for (const [index, workspace] of [oldest, owner, newest].entries()) {
    await db.owner.query('UPDATE nazir.workspaces SET created_at=$1 WHERE id=$2', [`2020-01-0${index + 1}T00:00:00Z`, workspace.workspaceId]);
  }
  await db.owner.query("DELETE FROM nazir.member_roles WHERE member_id=$1 AND role='service_owner'", [oldest.memberId]);
  expect(await ensureHomeWorkspace(db.driver, user.id)).toBe(owner.workspaceId);
  await db.owner.query('DELETE FROM nazir.member_roles WHERE member_id IN ($1,$2)', [owner.memberId, newest.memberId]);
  expect(await ensureHomeWorkspace(db.driver, user.id)).toBe(oldest.workspaceId);
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
