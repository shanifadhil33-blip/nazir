import { afterAll, beforeAll, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ auth: vi.fn(), runtimeDriver: vi.fn() }));
vi.mock('../../src/auth', () => ({ auth: fake.auth }));
vi.mock('../../src/server/db/runtime', () => ({ runtimeDriver: fake.runtimeDriver }));
import { loadMemberSnapshot } from '../../src/server/shell/member-data';
import { GET as me } from '../../src/app/api/me/route';
import { GET as settings } from '../../src/app/api/workspaces/[workspaceId]/settings/route';
import { GET as reports } from '../../src/app/api/workspaces/[workspaceId]/reports/route';
import { GET as proposals } from '../../src/app/api/workspaces/[workspaceId]/proposals/route';
import { createReport, listReports } from '../../src/server/reports/read';
import { listProposals } from '../../src/server/repair/list';
import { readAgentSettings } from '../../src/server/settings/agent-settings';
import { Forbidden, Unauthorized } from '../../src/server/http/errors';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import type { Role } from '../../src/server/auth/roles';
let db: TestDatabase;
let workspace: string;
const members = {} as Record<Role, string>;
beforeAll(async () => {
  db = await testDatabase(); fake.runtimeDriver.mockReturnValue(db.driver);
  const s = await seed(db, 'Shell'); workspace = s.workspace_id;
  for (const role of ['service_owner', 'quality_reviewer', 'viewer', 'supplier_maintainer'] as Role[]) members[role] = await db.createMember(workspace, [role], role);
  const { cancelRunAsMember } = await import('../../src/server/runner/cancel');
  await cancelRunAsMember(db.driver, s.member_id, s.ids.runs);
  await createReport(db.driver, s.member_id, { run_id: s.ids.runs });
});
afterAll(async () => db?.close());

it('returns no-store 401 from every parallel API and rejects unsigned server first paint', async () => {
  fake.auth.mockResolvedValue(null);
  const request = new Request('https://example.test');
  const context = { params: Promise.resolve({ workspaceId: workspace }) };
  for (const response of await Promise.all([me(request), settings(request, context), reports(request, context), proposals(request, context)])) {
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
  await expect(loadMemberSnapshot(workspace, 'en', true, true, true)).rejects.toBeInstanceOf(Unauthorized);
});

it.each(['service_owner', 'quality_reviewer', 'viewer', 'supplier_maintainer'] as Role[])('keeps %s data identical to the existing role-scoped services', async (role) => {
  const memberId = members[role];
  fake.auth.mockResolvedValue({ user: { id: 'user', name: 'Omar Haddad', email: 'test@example.test' }, memberships: [{ workspaceId: workspace, memberId, roles: [role], workspaceName: 'Shell' }] });
  const loaded = await loadMemberSnapshot(workspace, 'ar', true, true, true);
  expect(loaded.reports).toEqual((await listReports(db.driver, memberId)).reports);
  expect(loaded.fixes).toEqual((await listProposals(db.driver, memberId)).proposals);
  const setting = await readAgentSettings(db.driver, memberId).catch(() => null);
  expect(loaded.settings).toEqual(setting ? { name: setting.name, language: setting.language, focus_pack: setting.focus_pack } : null);
  expect(loaded.lang).toBe('ar');
  expect(loaded.roles).toEqual([role]);
  expect(Object.keys(loaded.settings ?? {})).not.toContain('external_agent');
  await expect(loadMemberSnapshot(crypto.randomUUID(), 'en', true, true)).rejects.toBeInstanceOf(Forbidden);
  const small = await loadMemberSnapshot(workspace, 'en', true, false);
  expect(small.reports).toEqual([]); expect(small.fixes).toEqual([]);
});

it('seeds queued checks with null started_at under member RLS for reload and fresh sign-in', async () => {
  const other = await seed(db, 'QueuedShell');
  await db.owner.query("UPDATE nazir.runs SET status='queued',started_at=NULL WHERE id=$1", [other.ids.runs]);
  const sessionFor = (workspaceId: string, memberId: string) => ({ user: { id: 'user', name: 'Omar Haddad' }, memberships: [{ workspaceId, memberId, roles: ['service_owner'], workspaceName: 'Shell' }] });
  for (let visit = 0; visit < 2; visit++) {
    fake.auth.mockResolvedValue(sessionFor(other.workspace_id, other.member_id));
    const loaded = await loadMemberSnapshot(other.workspace_id, 'en', true, true, false, true);
    expect(loaded.activeRuns).toEqual([{ runId: other.ids.runs, done: 0, total: 1 }]);
  }
  fake.auth.mockResolvedValue(sessionFor(workspace, members.service_owner));
  expect((await loadMemberSnapshot(workspace, 'en', true, true, false, true)).activeRuns).toEqual([]);
  await expect(loadMemberSnapshot(other.workspace_id, 'en', true, true, false, true)).rejects.toBeInstanceOf(Forbidden);
});

it('keeps a failed server active-runs read unknown and recovers on the next load', async () => {
  fake.auth.mockResolvedValue({ user: { id: 'user' }, memberships: [{ workspaceId: workspace, memberId: members.service_owner, roles: ['service_owner'], workspaceName: 'Shell' }] });
  const broken: typeof db.driver = { transaction: (work) => db.driver.transaction((sql) => work({ query: (query, params) => {
    if (query.includes("status IN ('queued','running')")) throw new Error('Read unavailable');
    return sql.query(query, params);
  } })) };
  fake.runtimeDriver.mockReturnValue(broken);
  try {
    expect((await loadMemberSnapshot(workspace, 'en', true, true, false, true)).activeRuns).toBeNull();
  } finally { fake.runtimeDriver.mockReturnValue(db.driver); }
  expect((await loadMemberSnapshot(workspace, 'en', true, true, false, true)).activeRuns).toEqual([]);
});

it('carries trusted kind and a safe connection projection on first paint and fails closed on a connection read error', async () => {
  const memberId = members.service_owner;
  fake.auth.mockResolvedValue({ user: { id: 'user', name: 'Omar' }, memberships: [{ workspaceId: workspace, memberId, roles: ['service_owner'], kind: 'real', workspaceName: 'Nazir demo' }] });
  const loaded = await loadMemberSnapshot(workspace, 'en', true, false);
  expect(loaded).toMatchObject({ kind: 'real', connection: null, assistant: 'No agent connected' });
  const broken: typeof db.driver = { transaction: (work) => db.driver.transaction((sql) => work({ query: (query, params) => {
    if (query.includes('read_external_agent')) throw new Error('Unavailable');
    return sql.query(query, params);
  } })) };
  fake.runtimeDriver.mockReturnValue(broken);
  try { expect(await loadMemberSnapshot(workspace, 'en', true, false)).toMatchObject({ connection: null, assistant: 'No agent connected' }); }
  finally { fake.runtimeDriver.mockReturnValue(db.driver); }
});
