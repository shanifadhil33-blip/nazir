import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AdapterUser } from 'next-auth/adapters';
const runtime = vi.hoisted(() => ({ runtimeDriver: vi.fn() }));
vi.mock('../../src/server/db/runtime', () => runtime);
import { authConfig } from '../../src/auth';
import { createAuthAdapter } from '../../src/server/auth/adapter';
import { createWorkspace } from '../../src/server/auth/workspaces';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
let db: TestDatabase;
let user: AdapterUser;
beforeAll(async () => {
  db = await testDatabase(); runtime.runtimeDriver.mockReturnValue(db.driver);
  const adapter = createAuthAdapter(() => db.driver);
  user = await adapter.createUser!({ id: crypto.randomUUID(), email: 'omar@example.test', name: 'Omar Haddad', image: null, emailVerified: null });
});
afterAll(async () => { await db?.close(); });
it('returns an empty real account session through the actual Auth.js callback', async () => {
  const expires = new Date(Date.now() + 60000).toISOString();
  const session = await authConfig.callbacks.session({ session: { expires }, user } as never);
  expect(session).toEqual({ expires, user: { id: user.id, name: 'Omar Haddad', email: 'omar@example.test', image: null }, memberships: [] });
});
it('loads only the signed in user memberships and fresh active roles', async () => {
  const other = await createAuthAdapter(() => db.driver).createUser!({ id: crypto.randomUUID(), email: 'yousef@example.test', name: 'Yousef Karim', image: null, emailVerified: null });
  await createWorkspace(db.driver, other.id, { name: 'Yousef workspace' });
  const own = await createWorkspace(db.driver, user.id, { name: 'Omar workspace' });
  await db.owner.query("INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES($1,$2,'quality_reviewer')", [own.workspaceId, own.memberId]);
  const session = await authConfig.callbacks.session({ session: { expires: new Date().toISOString() }, user } as never);
  expect(session.memberships).toEqual([{ ...own, workspaceName: 'Omar workspace', kind: 'real', roles: ['quality_reviewer', 'service_owner'], roleLabels: { en: ['Service quality reviewer', 'Service owner'], ar: ['مراجع جودة الخدمة', 'مالك الخدمة'] } }]);
});
it('caps how many workspaces one person can belong to', async () => {
  const adapter = createAuthAdapter(() => db.driver);
  const hamid = await adapter.createUser!({ id: crypto.randomUUID(), email: 'hamid@example.test', name: 'Hamid Rashed', image: null, emailVerified: null });
  for (let index = 0; index < 10; index++) await createWorkspace(db.driver, hamid.id, { name: `Hamid workspace ${index}` });
  await expect(createWorkspace(db.driver, hamid.id, { name: 'One too many' })).rejects.toMatchObject({ name: 'TooMany' });
});
