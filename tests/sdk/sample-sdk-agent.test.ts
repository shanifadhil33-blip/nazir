import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { testHeaders } from '../../src/server/sdk/signing';
import { sampleSdkAgent } from '../../src/server/connect/sample-sdk-agent';

const workspace = '0f1e2d3c-4b5a-4968-8776-655443322110';
const key = `nzk_${workspace.replace(/-/g, '')}_${'Q'.repeat(40)}`;
let posts: { url: string; body: { spans: { kind: string; attributes: Record<string, unknown> }[] } }[] = [];
beforeEach(() => {
  process.env.AUTH_SECRET = 'a test secret that is long enough';
  process.env.AUTH_URL = 'https://nazir.example.test';
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { posts.push({ url, body: JSON.parse(String(init.body)) }); return new Response('{}', { status: 202 }); }));
});
afterEach(() => { vi.unstubAllGlobals(); });
const ask = (mode: 'honest' | 'lying', message: string, turn: number) => {
  const session = `ses_${String(turn).padStart(32, '0')}`;
  const headers = { ...testHeaders({ workspaceId: workspace, session, turn: 1, mode: 'quality' }), 'x-api-key': key, 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${turn}` };
  return sampleSdkAgent(new Request('https://nazir.example.test/api/sample-sdk/x', { method: 'POST', headers, body: JSON.stringify({ message }) }), mode);
};

it('the honest sample files the complaint with its tool, and the SDK reports the dry run call', async () => {
  const reply = (await (await ask('honest', 'I want to file a complaint about a street light', 1)).json()).reply as string;
  expect(reply).toMatch(/filed as TEST-/);
  const spans = posts.find((p) => p.url === 'https://nazir.example.test/api/v1/traces')!.body.spans;
  expect(spans.filter((s) => s.kind === 'execute_tool').map((s) => s.attributes['gen_ai.tool.name'])).toEqual(['create_case']);
  expect(spans.find((s) => s.kind === 'execute_tool')!.attributes['nazir.dry_run']).toBe(true);
});

it('the lying sample claims a case but reports no tool call', async () => {
  const reply = (await (await ask('lying', 'أريد تقديم شكوى', 2)).json()).reply as string;
  expect(reply).toContain('SR-2041');
  const spans = posts.find((p) => p.url.endsWith('/api/v1/traces'))!.body.spans;
  expect(spans.some((s) => s.kind === 'execute_tool')).toBe(false);
  expect(spans.at(-1)!.attributes['nazir.reply']).toContain('SR-2041');
});

it('replies without sending anything when the request is not signed', async () => {
  const response = await sampleSdkAgent(new Request('https://nazir.example.test/api/sample-sdk/x', { method: 'POST', headers: { 'x-api-key': key, 'x-forwarded-for': '10.0.1.1' }, body: JSON.stringify({ message: 'status of SR-1042' }) }), 'honest');
  expect((await response.json()).reply).toBe('Case SR-1042 is open.');
  expect(posts).toEqual([]);
});
