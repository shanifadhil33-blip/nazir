import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const fake = vi.hoisted(() => ({ auth: vi.fn(), driver: undefined as unknown, set: vi.fn(), redirect: vi.fn(), proto: 'https' }));
vi.mock('../../src/auth', () => ({ auth: fake.auth }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: () => fake.driver }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-proto': fake.proto }), cookies: async () => ({ set: fake.set }) }));
vi.mock('next/navigation', () => ({ redirect: fake.redirect }));
import { createAuthAdapter, sessionHash } from '../../src/server/auth/adapter';
import { demoCookie, demoLoginEnabled, demoRoles, demoWorkspaceId, startDemoSession } from '../../src/server/auth/demo';
import { demoSignIn } from '../../src/server/auth/demo-action';
import { createWorkspace, ensureHomeWorkspace } from '../../src/server/auth/workspaces';
import { requireMember } from '../../src/server/auth/session';
import { sessionShape } from '../../src/server/auth/shape';
import { SignIn } from '../../src/components/landing/sign-in';
import { Forbidden } from '../../src/server/http/errors';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); fake.driver = db.driver; });
afterAll(async () => { await db?.close(); });
beforeEach(() => { fake.set.mockReset(); fake.redirect.mockReset(); fake.proto = 'https'; });
afterEach(() => { vi.unstubAllEnvs(); });
const demoUser = async (name: string) => (await db.owner.query<{ id: string }>('SELECT id FROM nazir.users WHERE email=$1', [`${name}@demo.nazir.test`])).rows[0]!.id;

it('turns demo login on only with DEMO_LOGIN=1 and a sign in secret', () => {
  expect(demoLoginEnabled({ DEMO_LOGIN: '1', AUTH_SECRET: 's' })).toBe(true);
  expect(demoLoginEnabled({ DEMO_LOGIN: '1' })).toBe(false);
  expect(demoLoginEnabled({ AUTH_SECRET: 's' })).toBe(false);
  expect(demoLoginEnabled({ DEMO_LOGIN: 'true', AUTH_SECRET: 's' })).toBe(false);
  expect(demoLoginEnabled({})).toBe(false);
});

it('refuses the action when the flag is off and never touches the database', async () => {
  vi.stubEnv('DEMO_LOGIN', ''); vi.stubEnv('AUTH_SECRET', 'secret');
  await expect(demoSignIn('owner')).rejects.toThrow('not available');
  expect(fake.set).not.toHaveBeenCalled();
  expect(fake.redirect).not.toHaveBeenCalled();
  expect((await db.owner.query('SELECT 1 FROM nazir.auth_sessions')).rows).toHaveLength(0);
});

it('refuses any role outside the four, in the app and in the database', async () => {
  vi.stubEnv('DEMO_LOGIN', '1'); vi.stubEnv('AUTH_SECRET', 'secret');
  for (const role of ['admin', '', 'Owner', 'service_owner', '1; DROP TABLE x']) await expect(demoSignIn(role)).rejects.toThrow();
  const expires = new Date(Date.now() + 3600_000);
  await expect(db.driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_auth'); await sql.query('SELECT * FROM nazir.auth_demo_session($1,$2,$3)', ['admin', sessionHash('x'), expires]); })).rejects.toThrow('Choose one of the demo people');
  for (const bad of [new Date(Date.now() - 1000), new Date(Date.now() + 48 * 3600_000)]) {
    await expect(db.driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_auth'); await sql.query('SELECT * FROM nazir.auth_demo_session($1,$2,$3)', ['owner', sessionHash('y'), bad]); })).rejects.toThrow('short');
  }
  expect(fake.set).not.toHaveBeenCalled();
  expect((await db.owner.query('SELECT 1 FROM nazir.auth_sessions')).rows).toHaveLength(0);
});

it('signs in each fixed person with a short Auth.js database session cookie', async () => {
  vi.stubEnv('DEMO_LOGIN', '1'); vi.stubEnv('AUTH_SECRET', 'secret');
  const names = { owner: 'omar.mansoor', editor: 'yusuf.haddad', viewer: 'khalid.rahman', supplier: 'bilal.nasser' };
  for (const role of demoRoles) {
    fake.set.mockReset();
    await demoSignIn(role);
    const [name, token, options] = fake.set.mock.calls[0]!;
    expect(name).toBe('__Secure-authjs.session-token');
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fake.redirect).toHaveBeenLastCalledWith(`/w/${demoWorkspaceId}`);
    const session = await createAuthAdapter(() => db.driver).getSessionAndUser!(token);
    expect(session!.user.email).toBe(`${names[role]}@demo.nazir.test`);
    const hours = ((options as { expires: Date }).expires.getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(11.9); expect(hours).toBeLessThanOrEqual(12);
    expect((await db.owner.query('SELECT token_hash FROM nazir.auth_sessions WHERE token_hash=$1', [sessionHash(token)])).rows).toHaveLength(1);
  }
  fake.proto = 'http'; fake.set.mockReset();
  await demoSignIn('viewer');
  expect(fake.set.mock.calls[0]![0]).toBe('authjs.session-token');
  expect(fake.set.mock.calls[0]![2]).toMatchObject({ secure: false });
  expect(demoCookie('t', new Date(), false).name).toBe('authjs.session-token');
});

it('gives each demo person exactly one role in the demo workspace', async () => {
  const rows = (await db.owner.query<{ email: string; roles: string[]; kind: string; status: string }>(
    `SELECT u.email,array_agg(r.role) AS roles,w.kind,m.status FROM nazir.users u JOIN nazir.members m ON m.user_id=u.id JOIN nazir.workspaces w ON w.id=m.workspace_id JOIN nazir.member_roles r ON r.member_id=m.id
     WHERE u.email LIKE '%@demo.nazir.test' GROUP BY u.email,w.kind,m.status ORDER BY u.email`)).rows;
  expect(rows).toEqual([
    { email: 'bilal.nasser@demo.nazir.test', roles: ['supplier_maintainer'], kind: 'demo', status: 'active' },
    { email: 'khalid.rahman@demo.nazir.test', roles: ['viewer'], kind: 'demo', status: 'active' },
    { email: 'omar.mansoor@demo.nazir.test', roles: ['service_owner'], kind: 'demo', status: 'active' },
    { email: 'yusuf.haddad@demo.nazir.test', roles: ['quality_reviewer'], kind: 'demo', status: 'active' },
  ]);
  expect((await db.owner.query('SELECT a.name,s.focus_pack FROM nazir.agents a JOIN nazir.agent_settings s ON s.workspace_id=a.workspace_id WHERE a.workspace_id=$1', [demoWorkspaceId])).rows)
    .toEqual([{ name: 'Fictional Service Agent', focus_pack: 'government' }]);
});

it('keeps demo people out of workspace creation and real workspaces', async () => {
  const omar = await demoUser('omar.mansoor');
  await expect(createWorkspace(db.driver, omar, { name: 'Mine' })).rejects.toBeInstanceOf(Forbidden);
  await expect(db.driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_auth'); await sql.query("SELECT set_config('app.auth_user_id',$1,true)", [omar]);
    await sql.query("SELECT * FROM nazir.auth_create_workspace($1,'Mine')", [omar]);
  })).rejects.toThrow('Demo accounts cannot create workspaces');
  // Home workspace for a demo person is the demo membership, never a new workspace.
  expect(await ensureHomeWorkspace(db.driver, omar)).toBe(demoWorkspaceId);
  const real = await db.bootstrap('real-owner');
  const realWorkspace = (await db.owner.query('UPDATE nazir.workspaces SET kind=$2 WHERE id=$1 RETURNING id', [real.workspace_id, 'real'])).rows[0]!.id as string;
  const shape = await sessionShape(db.driver, { id: omar, email: 'omar.mansoor@demo.nazir.test', name: 'Omar Mansoor', emailVerified: null });
  expect(shape.memberships.map((m) => m.workspaceId)).toEqual([demoWorkspaceId]);
  fake.auth.mockResolvedValue(shape);
  await expect(requireMember(realWorkspace)).rejects.toBeInstanceOf(Forbidden);
  expect((await requireMember(demoWorkspaceId)).roles).toEqual(['service_owner']);
  expect((await db.owner.query("SELECT count(*)::int AS n FROM nazir.workspaces WHERE created_by=$1", [omar])).rows[0]).toEqual({ n: 1 });
});

it('refuses new memberships for demo people outside the demo workspace, and removal of demo rows', async () => {
  const khalid = await demoUser('khalid.rahman');
  const real = await db.bootstrap('another-owner');
  await expect(db.owner.query('INSERT INTO nazir.members(workspace_id,user_id,display_name) VALUES($1,$2,$3)', [real.workspace_id, khalid, 'Khalid'])).rejects.toThrow('cannot join');
  await expect(db.worker(real.workspace_id, (sql) => sql.query("SELECT nazir.add_member('bilal.nasser@demo.nazir.test','Bilal',ARRAY['viewer'])"))).rejects.toThrow(/cannot join|fixed/);
  await expect(db.owner.query('DELETE FROM nazir.members WHERE user_id=$1', [khalid])).rejects.toThrow('cannot be removed');
  await expect(db.owner.query('DELETE FROM nazir.users WHERE id=$1', [khalid])).rejects.toThrow('cannot be removed');
  await expect(db.owner.query("INSERT INTO nazir.users(email,name) VALUES('new@demo.nazir.test','New')")).rejects.toThrow('fixed');
});

it('keeps demo users, members and sessions through a demo reset', async () => {
  const token = 'reset-check-token';
  await db.driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_auth'); await sql.query('SELECT * FROM nazir.auth_demo_session($1,$2,$3)', ['owner', sessionHash(token), new Date(Date.now() + 3600_000)]); });
  const before = async () => (await db.owner.query<{ n: number }>("SELECT (SELECT count(*) FROM nazir.users WHERE email LIKE '%@demo.nazir.test')+(SELECT count(*) FROM nazir.members WHERE workspace_id=$1)+(SELECT count(*) FROM nazir.auth_sessions WHERE token_hash=$2) AS n", [demoWorkspaceId, sessionHash(token)])).rows[0]!.n;
  const count = Number(await before());
  await db.worker(demoWorkspaceId, (sql) => sql.query("SELECT nazir.demo_recycle($1,1,'on_demand',now())", [demoWorkspaceId]));
  expect(Number(await before())).toBe(count);
  expect(count).toBe(9);
});

it('startDemoSession rejects a bad role before any database call', async () => {
  const driver = { transaction: vi.fn() };
  await expect(startDemoSession(driver, 'admin', true)).rejects.toThrow();
  expect(driver.transaction).not.toHaveBeenCalled();
});

const noop = async () => {};
it('shows the four demo people in English only when the server passes the action', () => {
  const on = renderToStaticMarkup(SignIn({ lang: 'en', action: noop, demoAction: noop }));
  for (const text of ['Omar, service owner', 'Yusuf, quality reviewer', 'Khalid, viewer', 'Bilal, supplier', 'You will land on the home screen as this person.', 'Continue with Google', 'id="demo"', 'nz-pill-btn']) expect(on).toContain(text);
  expect(on.match(/<form/g)).toHaveLength(5);
  const off = renderToStaticMarkup(SignIn({ lang: 'en', action: noop }));
  expect(off).not.toContain('id="demo"'); expect(off).not.toContain('Omar'); expect(off.match(/<form/g)).toHaveLength(1);
});

it('shows the four demo people in Arabic', () => {
  const html = renderToStaticMarkup(SignIn({ lang: 'ar', action: noop, demoAction: noop }));
  for (const text of ['عمر، مالك الخدمة', 'يوسف، مراجع الجودة', 'خالد، مشاهد', 'بلال، المورّد', 'ستصل إلى الشاشة الرئيسية بصفة هذا الشخص.', 'dir="rtl"']) expect(html).toContain(text);
  expect(html).not.toContain('Omar');
});
