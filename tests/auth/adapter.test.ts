import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Adapter, AdapterUser } from 'next-auth/adapters';
import { createAuthAdapter, sessionHash, authCall } from '../../src/server/auth/adapter';
import { sessionShape } from '../../src/server/auth/shape';
import { createWorkspace } from '../../src/server/auth/workspaces';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
let db: TestDatabase;
let adapter: Adapter;
let user: AdapterUser;
beforeAll(async () => { db = await testDatabase(); adapter = createAuthAdapter(() => db.driver); });
afterAll(async () => { await db?.close(); });
it('creates a lowercase identity with no workspace and updates profile fields', async () => {
  user = await adapter.createUser!({ email: 'Saeed@EXAMPLE.TEST', name: 'Saeed', image: null, emailVerified: null, id: crypto.randomUUID() });
  expect(user.email).toBe('saeed@example.test');
  expect(await adapter.getUser!(user.id)).toEqual(user);
  expect(await adapter.getUserByEmail!('SAEED@example.test')).toEqual(user);
  expect(await adapter.getUser!(crypto.randomUUID())).toBeNull();
  expect((await sessionShape(db.driver, user)).memberships).toEqual([]);
  user = await adapter.updateUser!({ id: user.id, name: 'Saeed Al Hashimi', image: 'https://example.test/picture', email: 'SAEED@example.test' });
  expect(user.name).toBe('Saeed Al Hashimi'); expect(user.email).toBe('saeed@example.test');
});
it('links and unlinks a Google identity without storing provider tokens', async () => {
  await adapter.linkAccount!({ provider: 'google', providerAccountId: 'fake-google-id', type: 'oidc', userId: user.id, access_token: 'never-store-access', refresh_token: 'never-store-refresh', id_token: 'never-store-id' });
  expect(await adapter.getUserByAccount!({ provider: 'google', providerAccountId: 'fake-google-id' })).toEqual(user);
  expect((await db.owner.query('SELECT * FROM nazir.auth_accounts')).rows).toEqual([{ provider: 'google', provider_account_id: 'fake-google-id', user_id: user.id }]);
  await adapter.unlinkAccount!({ provider: 'google', providerAccountId: 'fake-google-id' });
  expect(await adapter.getUserByAccount!({ provider: 'google', providerAccountId: 'fake-google-id' })).toBeNull();
});
it('round trips, updates and deletes sessions while storing only the token hash', async () => {
  const value = { sessionToken: 'fake-session-token', userId: user.id, expires: new Date(Date.now() + 60000) };
  expect(await adapter.createSession!(value)).toEqual(value);
  expect(await adapter.getSessionAndUser!(value.sessionToken)).toEqual({ session: value, user });
  const rows = (await db.owner.query('SELECT * FROM nazir.auth_sessions')).rows;
  expect(rows[0]!.token_hash).toBe(sessionHash(value.sessionToken));
  expect(JSON.stringify(rows)).not.toContain(value.sessionToken);
  const expires = new Date(Date.now() + 120000);
  expect(await adapter.updateSession!({ sessionToken: value.sessionToken, expires })).toEqual({ ...value, expires });
  expect(await adapter.updateSession!({ sessionToken: value.sessionToken })).toEqual({ ...value, expires });
  await adapter.deleteSession!(value.sessionToken);
  expect(await adapter.getSessionAndUser!(value.sessionToken)).toBeNull();
});
it('deletes expired sessions on read and refuses their renewal', async () => {
  await adapter.createSession!({ sessionToken: 'expired-fake', userId: user.id, expires: new Date(0) });
  expect(await adapter.updateSession!({ sessionToken: 'expired-fake', expires: new Date(Date.now() + 60000) })).toBeNull();
  expect(await adapter.getSessionAndUser!('expired-fake')).toBeNull();
  expect((await db.owner.query('SELECT * FROM nazir.auth_sessions')).rows).toEqual([]);
});
it.each(['nazir_app', 'nazir_worker', 'nazir_sandbox', 'nazir_inspector', 'nazir_auth'])('refuses auth table access as %s', async (role) => {
  for (const table of ['auth_accounts', 'auth_sessions']) for (const action of ['SELECT * FROM', 'DELETE FROM']) {
    await expect(db.driver.transaction(async (sql) => { await sql.query(`SET LOCAL ROLE ${role}`); await sql.query(`${action} nazir.${table}`); })).rejects.toThrow(/permission denied/);
  }
});
it('creates a real workspace, owner membership and an audit snapshot', async () => {
  const created = await createWorkspace(db.driver, user.id, { name: 'Saeed test workspace' });
  const result = await sessionShape(db.driver, user);
  expect(result.memberships).toEqual([{ ...created, workspaceName: 'Saeed test workspace', kind: 'real', roles: ['service_owner'], roleLabels: { en: ['Service owner'], ar: ['مالك الخدمة'] } }]);
  expect((await db.owner.query('SELECT action,actor_member_id,actor_roles_at_event FROM nazir.audit_events WHERE workspace_id=$1', [created.workspaceId])).rows).toEqual([{ action: 'workspace.created', actor_member_id: created.memberId, actor_roles_at_event: ['service_owner'] }]);
  await db.owner.query("INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES($1,$2,'quality_reviewer')", [created.workspaceId, created.memberId]);
  expect((await sessionShape(db.driver, user)).memberships[0]!.roles).toEqual(['quality_reviewer', 'service_owner']);
  await db.owner.query("UPDATE nazir.members SET status='removed' WHERE id=$1", [created.memberId]);
  expect((await sessionShape(db.driver, user)).memberships).toEqual([]);
});
it('redacts storage errors and exposes only pinned definer functions to auth', async () => {
  await expect(authCall(db.driver, 'auth_create_user', [user.email, 'Saeed', null])).rejects.toThrow('Sign in storage is unavailable. Please try again.');
  const rows = (await db.owner.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>("SELECT proname,prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='nazir' AND has_function_privilege('nazir_auth',p.oid,'EXECUTE')")).rows;
  expect(rows).toHaveLength(13);
  for (const row of rows) { expect(row.proname).toMatch(/^auth_/); expect(row.prosecdef).toBe(true); expect(row.proconfig).toEqual(['search_path=pg_catalog, nazir']); }
  expect((await db.owner.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='nazir_auth'")).rows).toEqual([{ rolcanlogin: false }]);
});

it('binds membership reads and workspace creation to the signed in user context', async () => {
  await expect(db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_auth');
    await sql.query('SELECT * FROM nazir.auth_memberships($1)', [user.id]);
  })).rejects.toThrow('Sign in context required');
  await expect(db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_auth');
    await sql.query("SELECT set_config('app.auth_user_id',$1,true)", [crypto.randomUUID()]);
    await sql.query('SELECT * FROM nazir.auth_create_workspace($1,$2)', [user.id, 'Wrong context']);
  })).rejects.toThrow('Sign in context required');
});
