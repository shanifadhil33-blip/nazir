import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
const fake = vi.hoisted(() => ({ auth: vi.fn(), driver: vi.fn() }));
vi.mock('../../src/auth', () => ({ auth: fake.auth }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: fake.driver }));
import { GET, PUT, DELETE } from '../../src/app/api/workspaces/[workspaceId]/settings/test-people/route';
let db: TestDatabase, workspace: string, owner: string;
beforeAll(async () => {
  db = await testDatabase(); const who = await db.bootstrap('People routes');
  workspace = who.workspace_id; owner = who.member_id;
  await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [workspace]); fake.driver.mockReturnValue(db.driver);
}, 60000);
afterAll(async () => { await db?.close(); });
const context = () => ({ params: Promise.resolve({ workspaceId: workspace }) });
const request = (body = '{}') => new Request('https://nazir.example/api', { method: 'PUT', body, headers: { 'accept-language': 'ar' } });
function login(kind = 'real', roles = ['service_owner'], target = workspace) { fake.auth.mockResolvedValue({ user: { id: 'u', email: 'a@example.test' }, memberships: [{ memberId: owner, workspaceId: target, kind, roles }] }); }
it('rejects signed out, foreign account, demo and non-owner reads and writes before touching credentials', async () => {
  fake.auth.mockResolvedValue(null);
  for (const route of [GET, PUT, DELETE]) expect((await route(request(), context())).status).toBe(401);
  login('real', ['service_owner'], crypto.randomUUID());
  for (const route of [GET, PUT, DELETE]) expect([403, 404]).toContain((await route(request(), context())).status);
  const calls = fake.driver.mock.calls.length;
  for (const [kind, roles] of [['demo', ['service_owner']], ['real', ['viewer']], ['real', ['supplier_maintainer']]] as const) {
    login(kind, [...roles]);
    for (const route of [GET, PUT, DELETE]) {
      const response = await route(request(), context()); expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  }
  expect(fake.driver.mock.calls).toHaveLength(calls);
});
it('returns masked reads and rejects malformed and oversized bodies with plain localized errors', async () => {
  login();
  const response = await GET(request(), context()); expect(await response.json()).toEqual({ people: null });
  for (const body of ['{', '{}', 'x'.repeat(12001)]) {
    const rejected = await PUT(request(body), context()); expect(rejected.status).toBe(400);
    expect(JSON.stringify(await rejected.json())).toMatch(/[\u0600-\u06ff]/);
  }
  expect((await DELETE(request(), context())).status).toBe(200);
});
