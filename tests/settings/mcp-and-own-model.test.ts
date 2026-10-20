import { afterAll, beforeAll, expect, it } from 'vitest';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import { Coded, Forbidden } from '../../src/server/http/errors';
import { saveAgentSettings, ownModelForWorker } from '../../src/server/settings/agent-settings';
import { privateAddress, publicHttpsUrl } from '../../src/server/settings/net-guard';
import { mcpChat } from '../../src/server/agent/mcp-chat';
import { networkChatModel } from '../../src/server/runner/network-model';

const secret = 'test-secret-for-agent-settings-1234567890';
process.env.AUTH_SECRET = secret;
const resolve = async (host: string) => [{ address: host.startsWith('inward') ? '192.168.0.9' : '93.184.215.14' }];
let db: TestDatabase; let owner: string; let reviewer: string; let viewer: string; let workspaceId: string;
const calls: { method: string; name?: string }[] = [];
// A fake streamable HTTP MCP server: one read only tool and one write tool.
const mcpFetch = (async (_url: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  calls.push({ method: body.method, name: body.params?.name });
  if (init?.redirect !== 'error') throw new Error('redirects must be refused');
  if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26' } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } });
  if (!body.id) return new Response('', { status: 202 });
  if (body.method === 'tools/list') return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'list_tickets', annotations: { readOnlyHint: true } }, { name: 'close_ticket' }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `ran ${body.params.name}` }] } });
}) as typeof fetch;
const opts = { fetcher: mcpFetch, resolve };
const settings = { name: 'Desk', instructions: '', language: 'en', avatar: 'preset:1', mcp_servers: [{ name: 'Tickets', url: 'https://mcp.example.com/mcp' }, { name: 'Inside', url: 'https://inward.example.com/mcp' }], integrations: [], llm: null };

beforeAll(async () => {
  db = await testDatabase();
  const seeded = await seed(db, 'Mcp');
  owner = seeded.member_id; workspaceId = seeded.workspace_id;
  reviewer = await db.createMember(workspaceId, ['quality_reviewer'], 'Khalid Hamdan');
  viewer = await db.createMember(workspaceId, ['viewer'], 'Hamza Nasser');
  // Saving refuses the inward name, so store the inward one directly to prove the call time check too.
  await expect(saveAgentSettings(db.driver, owner, settings, secret, resolve)).rejects.toBeInstanceOf(Coded);
  await saveAgentSettings(db.driver, owner, { ...settings, mcp_servers: [settings.mcp_servers[0]] }, secret, resolve);
  await db.owner.query(`UPDATE nazir.agent_settings SET mcp_servers=$1::jsonb`, [JSON.stringify(settings.mcp_servers)]);
}, 60000);
afterAll(async () => { await db?.close(); });

it('flags private addresses, v4, v6 and mapped', () => {
  for (const a of ['10.1.1.1', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(privateAddress(a), a).toBe(true);
  expect(privateAddress('93.184.215.14')).toBe(false);
  expect(privateAddress('198.18.0.1')).toBe(true);
  process.env.NAZIR_ALLOW_BENCHMARK_DNS = '1';
  try { expect(privateAddress('198.18.0.1')).toBe(false); expect(privateAddress('10.0.0.1')).toBe(true); } finally { delete process.env.NAZIR_ALLOW_BENCHMARK_DNS; }
});
it('blocks a public looking name that resolves inward', async () => {
  expect(await publicHttpsUrl('https://inward.example.com', resolve)).toBe(false);
  expect(await publicHttpsUrl('https://api.example.com', resolve)).toBe(true);
  expect(await publicHttpsUrl('https://x.example.com', async () => { throw new Error('nx'); })).toBe(false);
});

it('lists tools and runs a read only tool at once with an audit record, in EN and AR', async () => {
  const listed = await mcpChat(db.driver, viewer, 'list tools on Tickets', null, opts);
  expect((listed!.data as { tools: { name: string; readOnly: boolean }[] }).tools).toEqual([{ name: 'list_tickets', readOnly: true }, { name: 'close_ticket', readOnly: false }]);
  expect((await mcpChat(db.driver, viewer, 'اعرض أدوات Tickets', null, opts))!.reply.ar).toContain('Tickets');
  await expect(mcpChat(db.driver, viewer, 'call list_tickets on Tickets', null, opts)).rejects.toBeInstanceOf(Forbidden);
  const ran = await mcpChat(db.driver, reviewer, 'call list_tickets on Tickets with {"open":true}', null, opts);
  expect(ran!.done).toBe(true);
  expect((ran!.data as { result: string }).result).toBe('ran list_tickets');
  const audit = (await db.owner.query<{ action: string }>("SELECT action FROM nazir.audit_events WHERE action LIKE 'mcp.call%' ORDER BY 1")).rows.map((r) => r.action);
  expect(audit).toContain('mcp.call_done');
});

it('holds a write tool until another allowed member sends the exact approval', async () => {
  calls.length = 0;
  const proposed = await mcpChat(db.driver, reviewer, 'call close_ticket on Tickets with {"id":7}', null, opts);
  const id = (proposed!.data as { id: string }).id;
  expect(proposed!.done).toBe(false);
  expect(calls.some((c) => c.method === 'tools/call')).toBe(false);
  await expect(mcpChat(db.driver, reviewer, `I approve MCP call ${id}`, null, opts)).rejects.toMatchObject({ code: 'four_eyes' });
  await expect(mcpChat(db.driver, viewer, `I approve MCP call ${id}`, null, opts)).rejects.toBeInstanceOf(Forbidden);
  const done = await mcpChat(db.driver, owner, `أوافق على استدعاء MCP ${id}`, null, opts);
  expect(done!.done).toBe(true);
  expect(calls.filter((c) => c.method === 'tools/call').map((c) => c.name)).toEqual(['close_ticket']);
  await expect(mcpChat(db.driver, owner, `I approve MCP call ${id}`, null, opts)).rejects.toMatchObject({ code: 'not_waiting' });
  const row = (await db.owner.query<{ status: string; proposed_by_name: string; approved_by_name: string }>('SELECT status,proposed_by_name,approved_by_name FROM nazir.mcp_calls WHERE id=$1', [id])).rows[0]!;
  expect(row).toMatchObject({ status: 'done', proposed_by_name: 'Khalid Hamdan' });
  expect(row.approved_by_name.length).toBeGreaterThan(0);
});

it('never contacts a server whose name resolves inward, and passes other messages on', async () => {
  calls.length = 0;
  const blocked = await mcpChat(db.driver, reviewer, 'list tools on Inside', null, opts);
  expect(blocked!.reply.en).toContain('private or unsafe');
  expect(calls).toHaveLength(0);
  expect(await mcpChat(db.driver, reviewer, 'list runs', null, opts)).toBeNull();
});

it('uses the own model for the agent under test and falls back to the free chain', async () => {
  const own = { provider: 'openai' as const, baseUrl: 'https://api.example.com/v1', model: 'm', key: 'sk-test-12345678' };
  let reserved = 0; const metas: string[] = [];
  const context = { workspaceId, conversationId: 'c', onCall: (m: { provider: string }) => { metas.push(m.provider); }, reserveCall: async () => { reserved++; }, remainingMs: () => 30000 };
  const okFetch = (async () => Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'create_case', arguments: '{}' } }] } }] })) as typeof fetch;
  const origFetch = globalThis.fetch;
  globalThis.fetch = okFetch;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = networkChatModel(db.driver, context as any, { own: Promise.resolve(own), resolve, store: { reserve: async () => true } as any });
    const tools = [{ type: 'function' as const, function: { name: 'create_case', description: 'x', parameters: { type: 'object', properties: {} } } }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reply = await runner.model({ messages: [{ role: 'user', content: 'hi' }], tools } as any);
    expect(reply.tool_calls?.[0]?.name).toBe('create_case');
    expect(metas).toEqual(['own_openai']);
    expect(reserved).toBe(1);
  } finally { globalThis.fetch = origFetch; }
  expect(await ownModelForWorker(db.driver, workspaceId, secret)).toBeNull();
});
