import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import { Forbidden } from '../../src/server/http/errors';
import { agentChat, type ChatChain } from '../../src/server/agent/chat';
import { hashToken, issueMcpToken, listMcpTokens, mcpHandle, revokeMcpToken } from '../../src/server/agent/mcp';
import { callsPerScenario } from '../../src/server/planner/bound';

const meta = { provider: 'scripted', model: 'scripted', family: 'unknown' as const, attempts: [], failover: false, failoverReason: null };
const chain = (content: string): ChatChain => ({ chat: async () => ({ content, meta }) });

let db: TestDatabase;
let workspaceId: string;
let reviewer: string;
let viewer: string;
let agentVersion: string;
let rulePack: string;
beforeAll(async () => {
  db = await testDatabase();
  const seeded = await seed(db, 'Agent');
  workspaceId = seeded.workspace_id;
  agentVersion = seeded.ids.agent_versions!;
  rulePack = seeded.ids.rule_pack_versions!;
  reviewer = await db.createMember(workspaceId, ['quality_reviewer'], 'Khalid Hamdan');
  viewer = await db.createMember(workspaceId, ['viewer'], 'Hamza Nasser');
  await db.owner.query("UPDATE nazir.scenarios SET status='approved' WHERE workspace_id=$1", [workspaceId]);
  await db.owner.query("UPDATE nazir.rule_pack_versions SET status='approved' WHERE id=$1", [rulePack]);
}, 60000);
afterAll(async () => { await db?.close(); });

it('lists runs and findings for a viewer and refuses a plan', async () => {
  const runs = await agentChat(db.driver, viewer, { message: 'اعرض التشغيلات' }, null);
  expect(runs.tool).toBe('list_runs');
  expect(runs.reply.ar).toMatch(/[\u0600-\u06ff]/);
  expect(JSON.stringify(runs.data)).not.toContain('frozen_manifest');
  const findings = await agentChat(db.driver, viewer, { message: 'list findings' }, chain('{"tool":"list_findings"}'));
  expect(findings.source).toBe('model');
  expect(JSON.stringify(findings.data)).not.toContain('agent_said');
  await expect(agentChat(db.driver, viewer, { message: 'اقترح خطة' }, null)).rejects.toBeInstanceOf(Forbidden);
  await expect(agentChat(db.driver, reviewer, { message: 'list runs' }, chain('{"tool":"drop_database"}'))).rejects.toThrow(/cannot add tools/);
});
it('proposes a plan inside the stated call budget', async () => {
  const proposed = await agentChat(db.driver, reviewer, { message: `propose a plan ${(callsPerScenario * 3)} calls` }, null);
  expect(proposed.tool).toBe('propose_plan');
  expect(proposed.reply.en).toContain('within the budget');
  const data = proposed.data as { plannedCalls: number; id: string };
  expect(data.plannedCalls).toBeLessThanOrEqual((callsPerScenario * 3));
  const row = (await db.owner.query<{ budget_calls: number }>('SELECT budget_calls FROM nazir.plans WHERE id=$1', [data.id])).rows[0]!;
  expect(row.budget_calls).toBeLessThanOrEqual((callsPerScenario * 3));
  expect((await db.owner.query("SELECT action FROM nazir.audit_events WHERE action='agent.message' AND target_id=$1", [proposed.thread_id])).rows.length).toBeGreaterThan(0);
});
it('proposes a valid plan when the message states no budget', async () => {
  const proposed = await agentChat(db.driver, reviewer, { message: 'propose a plan' }, null);
  expect(proposed.done).toBe(true);
  expect(proposed.reply.en).toMatch(/uses \d+ calls/);
  expect(proposed.reply.ar).toMatch(/[\u0600-\u06FF]/);
  const data = proposed.data as { plannedCalls: number; budget: { max: number } };
  expect(data.plannedCalls).toBeGreaterThan(0);
  expect(data.plannedCalls).toBeLessThanOrEqual(data.budget.max);
});
it('stores a hashed MCP token, revokes it, and keeps the same role refusal', async () => {
  const issued = await issueMcpToken(db.driver, viewer, { label: 'Viewer connector' });
  const stored = (await db.owner.query<{ token_hash: string }>('SELECT token_hash FROM nazir.mcp_tokens WHERE id=$1', [issued.id])).rows[0]!;
  expect(stored.token_hash).toBe(hashToken(issued.token));
  expect(stored.token_hash).toBe(createHash('sha256').update(issued.token).digest('hex'));
  expect(stored.token_hash).not.toBe(issued.token);
  const listed = await listMcpTokens(db.driver, viewer);
  expect(listed.some((token) => token.id === issued.id)).toBe(true);
  expect(JSON.stringify(listed)).not.toContain(stored.token_hash);
  await expect(mcpHandle(db.driver, issued.token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'propose_plan', arguments: { agent_version_id: agentVersion, rule_pack_version_id: rulePack, budget: { kind: 'calls', max: callsPerScenario } } } })).rejects.toBeInstanceOf(Forbidden);
  const runs = await mcpHandle(db.driver, issued.token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_runs', arguments: {} } });
  expect(JSON.stringify(runs.result)).not.toContain('frozen_manifest');
  await expect(mcpHandle(db.driver, issued.token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'export_all', arguments: {} } })).rejects.toThrow(/cannot add tools/);
  await revokeMcpToken(db.driver, viewer, issued.id);
  await expect(mcpHandle(db.driver, issued.token, { jsonrpc: '2.0', id: 4, method: 'tools/list' })).rejects.toThrow(/no longer valid/);
  expect((await db.owner.query("SELECT action FROM nazir.audit_events WHERE target_id=$1 AND action IN ('mcp.issued','mcp.revoked')", [issued.id])).rows).toHaveLength(2);
});
