import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const fake = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('../../src/auth', () => ({ auth: fake.auth }));
import { GET } from '../../src/app/api/me/route';
import { POST } from '../../src/app/api/workspaces/route';
import { requireMember, requireUser } from '../../src/server/auth/session';
import { Forbidden, Unauthorized } from '../../src/server/http/errors';
beforeEach(() => { fake.auth.mockReset(); });
it('returns worded no store 401 JSON when signed out', async () => {
  fake.auth.mockResolvedValue(null);
  const result = await GET();
  expect(result.status).toBe(401); expect(result.headers.get('Cache-Control')).toBe('no-store');
  expect(await result.json()).toEqual({ error: { code: 'unauthorized', message: 'Please sign in to continue.' } });
  await expect(requireUser()).rejects.toBeInstanceOf(Unauthorized);
  expect((await POST(new NextRequest('https://example.test/api/workspaces', { method: 'POST', body: '{}' }))).status).toBe(401);
});
it('returns the session shape and requires membership in the requested workspace', async () => {
  const session = { user: { id: crypto.randomUUID(), name: 'Saeed', email: 'saeed@example.test', image: null }, memberships: [{ workspaceId: 'workspace-a', memberId: 'member-a', roles: ['service_owner'], roleLabels: { en: ['Service owner'], ar: ['مالك الخدمة'] }, workspaceName: 'Test', kind: 'real' }] };
  fake.auth.mockResolvedValue(session);
  expect(await (await GET()).json()).toEqual(session);
  expect(await requireMember('workspace-a')).toEqual({ memberId: 'member-a', roles: ['service_owner'] });
  await expect(requireMember('workspace-b')).rejects.toBeInstanceOf(Forbidden);
});
