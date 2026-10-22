import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
const fake = vi.hoisted(() => ({ auth: vi.fn(), driver: vi.fn() }));
vi.mock('../../src/auth', () => ({ auth: fake.auth }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: fake.driver }));
import { GET, PUT, POST, DELETE } from '../../src/app/api/workspaces/[workspaceId]/settings/connection/route';
let db: TestDatabase, workspace: string, owner: string;
beforeAll(async () => { db = await testDatabase(); const a = await db.bootstrap('Connection routes'); workspace = a.workspace_id; owner = a.member_id; fake.driver.mockReturnValue(db.driver); });
afterAll(async () => { await db?.close(); });
const context = () => ({ params: Promise.resolve({ workspaceId: workspace }) });
const request = () => new Request('https://nazir.example/api', { method: 'POST', body: '{}', headers: { 'accept-language': 'ar' } });
function login(memberId: string, roles: string[], target = workspace) { fake.auth.mockResolvedValue({ user: { id: 'u', email: 'a@example.test' }, memberships: [{ memberId, workspaceId: target, roles }] }); }
it('refuses signed out users, hides other workspaces with 404, and denies writes from viewers and reviewers', async () => {
  fake.auth.mockResolvedValue(null);
  expect((await GET(request(), context())).status).toBe(401);
  login(owner, ['service_owner'], crypto.randomUUID());
  for (const route of [GET, PUT, POST, DELETE]) expect((await route(request(), context())).status).toBe(404);
  for (const role of ['quality_reviewer', 'viewer']) {
    const id = await db.createMember(workspace, [role as 'viewer']); login(id, [role]);
    expect((await GET(request(), context())).status).toBe(200);
    for (const route of [PUT, POST, DELETE]) {
      const response = await route(request(), context());
      expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).toMatch(/[\u0600-\u06ff]/);
    }
  }
});
it('allows owner reads and removal, validates input without sending a real request', async () => {
  login(owner, ['service_owner']);
  const read = await GET(request(), context()); expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toBe('no-store');
  expect((await PUT(request(), context())).status).toBe(400);
  expect((await POST(request(), context())).status).toBe(404);
  expect((await DELETE(request(), context())).status).toBe(200);
});
