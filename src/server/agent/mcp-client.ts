import 'server-only';
import { publicHttpsUrl, type Resolver } from '../settings/net-guard';

export type McpTool = { name: string; description?: string; readOnly: boolean };
type Rpc = { jsonrpc: '2.0'; id?: number | string; result?: unknown; error?: { message?: string } };
const MAX = 256 * 1024;

async function readRpc(response: Response, id: number): Promise<Rpc | null> {
  const text = (await response.text()).slice(0, MAX);
  const type = response.headers.get('content-type') ?? '';
  const bodies = type.includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()) : [text];
  for (const body of bodies) {
    try { const msg = JSON.parse(body) as Rpc; if (msg && msg.id === id) return msg; } catch { /* next event */ }
  }
  return null;
}

/** Minimal streamable HTTP MCP client: initialize, then one request. No redirects, 15 s per request, public addresses only. */
export async function mcpRequest(url: string, method: string, params: unknown, options: { fetcher?: typeof fetch; resolve?: Resolver } = {}) {
  const fetcher = options.fetcher ?? fetch;
  if (!await publicHttpsUrl(url, options.resolve)) throw new Error('blocked_address');
  const post = (body: unknown, session?: string) => fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(body) });
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'nazir', version: 'n27' } } });
  if (!init.ok) throw new Error(`mcp_http_${init.status}`);
  const session = init.headers.get('mcp-session-id') ?? undefined;
  await readRpc(init, 1);
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, session).then((r) => r.text()).catch(() => undefined);
  const response = await post({ jsonrpc: '2.0', id: 2, method, params }, session);
  if (!response.ok) throw new Error(`mcp_http_${response.status}`);
  const rpc = await readRpc(response, 2);
  if (!rpc) throw new Error('mcp_bad_reply');
  if (rpc.error) throw new Error('mcp_error');
  return rpc.result;
}

export async function listServerTools(url: string, options?: Parameters<typeof mcpRequest>[3]): Promise<McpTool[]> {
  const result = await mcpRequest(url, 'tools/list', {}, options) as { tools?: { name?: unknown; description?: unknown; annotations?: { readOnlyHint?: unknown } }[] };
  return (result?.tools ?? []).filter((t) => typeof t.name === 'string').slice(0, 100).map((t) => ({
    name: String(t.name).slice(0, 120), ...(typeof t.description === 'string' ? { description: t.description.slice(0, 300) } : {}), readOnly: t.annotations?.readOnlyHint === true,
  }));
}

export async function callServerTool(url: string, tool: string, args: Record<string, unknown>, options?: Parameters<typeof mcpRequest>[3]) {
  const result = await mcpRequest(url, 'tools/call', { name: tool, arguments: args }, options) as { content?: { type?: string; text?: string }[]; isError?: boolean };
  const text = (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').slice(0, 2000);
  return { ok: result?.isError !== true, text };
}
