import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded, NotFound } from '../http/errors';
import { plannerTools } from '../planner/bound';
import { runPlannerTool } from './tools';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const labelInput = z.object({ label: z.string().trim().min(1).max(80).default('Agent connector') }).strict();

export async function issueMcpToken(driver: TransactionDriver, memberId: string, value: unknown = {}) {
  const input = labelInput.parse(value);
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'mcp.issue');
    const row = (await sql.query<{ id: string }>(`INSERT INTO nazir.mcp_tokens(workspace_id,member_id,token_hash,label) VALUES(nazir.current_workspace_id(),nazir.current_member_id(),$1,$2) RETURNING id`, [tokenHash, input.label])).rows[0]!;
    await sql.query("SELECT nazir.append_audit('mcp.issued','mcp_token',$1,$2)", [row.id, JSON.stringify({ label: input.label })]);
    return { id: row.id, token };
  });
}

export async function listMcpTokens(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'mcp.issue');
    return (await sql.query<{ id: string; label: string; created_at: string; revoked_at: string | null }>('SELECT id,label,created_at,revoked_at FROM nazir.mcp_tokens ORDER BY created_at DESC,id')).rows;
  });
}

export async function revokeMcpToken(driver: TransactionDriver, memberId: string, tokenId: string) {
  z.uuid().parse(tokenId);
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'mcp.issue');
    const row = (await sql.query<{ id: string }>('UPDATE nazir.mcp_tokens SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL RETURNING id', [tokenId])).rows[0];
    if (!row) throw new NotFound();
    await sql.query("SELECT nazir.append_audit('mcp.revoked','mcp_token',$1,'{}')", [row.id]);
    return { id: row.id, revoked: true };
  });
}

export async function resolveMcpToken(driver: TransactionDriver, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_app');
    return (await sql.query<{ member_id: string; workspace_id: string }>('SELECT * FROM nazir.mcp_resolve($1)', [hashToken(token)])).rows[0] ?? null;
  });
}

export const mcpTools = plannerTools.map((name) => ({
  name,
  description: name === 'list_runs' ? 'List test runs in this workspace.' : name === 'list_findings' ? 'List findings in this workspace.' : 'Propose a test plan within a budget.',
  inputSchema: { type: 'object' },
}));

const rpc = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number(), z.null()]), method: z.string().min(1).max(80), params: z.unknown().optional() }).strict();

export function bearerToken(header: string | null) {
  const match = header?.match(/^Bearer ([a-f0-9]{64})$/);
  return match?.[1] ?? null;
}

export function secretMatches(header: string | null, secret: string) {
  const got = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const left = Buffer.from(got);
  const right = Buffer.from(secret);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** MCP tool calls use the token member and the same tool runner as the app. */
export async function mcpHandle(driver: TransactionDriver, token: string, value: unknown) {
  const body = rpc.parse(value);
  const member = await resolveMcpToken(driver, token);
  if (!member) throw new Coded(401, 'unauthorized', 'The token is no longer valid.');
  if (body.method === 'initialize') return { jsonrpc: '2.0' as const, id: body.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'nazir', version: 'n21' } } };
  if (body.method === 'tools/list') return { jsonrpc: '2.0' as const, id: body.id, result: { tools: mcpTools } };
  if (body.method === 'tools/call') {
    const params = z.object({ name: z.string().min(1).max(80), arguments: z.unknown().optional() }).strict().parse(body.params ?? {});
    if (!(plannerTools as readonly string[]).includes(params.name)) throw new Coded(403, 'widens_tools', 'A plan cannot add tools.');
    const data = await runPlannerTool(driver, member.member_id, params.name, params.arguments ?? {});
    return { jsonrpc: '2.0' as const, id: body.id, result: { content: [{ type: 'text', text: params.name }], data } };
  }
  throw new Coded(400, 'validation', 'Check the details and try again.');
}
