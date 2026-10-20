import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const fake = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('../../src/auth', () => ({ auth: fake.auth }));
import { GET as listReports, POST as createReport } from '../../src/app/api/workspaces/[workspaceId]/reports/route';
import { GET as fullReport } from '../../src/app/api/workspaces/[workspaceId]/reports/[reportId]/route';
import { POST as chat } from '../../src/app/api/workspaces/[workspaceId]/agent/chat/route';
import { POST as mcp } from '../../src/app/api/mcp/route';
import { GET as cron } from '../../src/app/api/cron/demo-reset/route';
import { POST as reset } from '../../src/app/api/workspaces/[workspaceId]/demo-reset/route';

const params = Promise.resolve({ workspaceId: 'workspace', reportId: 'report', tokenId: 'token' });
beforeEach(() => { fake.auth.mockReset(); delete process.env.CRON_SECRET; });

it('asks for sign in before any report, chat, connector, or reset work', async () => {
  fake.auth.mockResolvedValue(null);
  const body = JSON.stringify({});
  const calls = [
    createReport(new NextRequest('https://example.test/api/workspaces/workspace/reports', { method: 'POST', body }), { params }),
    listReports(new NextRequest('https://example.test/api/workspaces/workspace/reports'), { params }),
    fullReport(new NextRequest('https://example.test/report'), { params }),
    chat(new NextRequest('https://example.test/chat', { method: 'POST', body }), { params }),
    reset(new NextRequest('https://example.test/reset', { method: 'POST', body }), { params }),
    mcp(new NextRequest('https://example.test/api/mcp', { method: 'POST', body })),
    cron(new NextRequest('https://example.test/api/cron/demo-reset')),
  ];
  for (const pending of calls) {
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control') ?? response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: { code: 'unauthorized', message: 'Please sign in to continue.' } });
  }
});
it('returns the Arabic sign in line when the caller asks for Arabic', async () => {
  fake.auth.mockResolvedValue(null);
  const headers = { 'accept-language': 'ar' };
  const arabic = { error: { code: 'unauthorized', message: 'يرجى تسجيل الدخول للمتابعة.' } };
  expect(await (await chat(new NextRequest('https://example.test/chat', { method: 'POST', body: '{}', headers }), { params })).json()).toEqual(arabic);
  expect(await (await mcp(new NextRequest('https://example.test/api/mcp', { method: 'POST', body: '{}', headers }))).json()).toEqual(arabic);
  expect(await (await chat(new NextRequest('https://example.test/chat', { method: 'POST', body: JSON.stringify({ message: 'اقترح خطة' }) }), { params })).json()).toEqual(arabic);
});
