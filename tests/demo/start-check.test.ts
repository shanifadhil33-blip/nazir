import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { installDemoLibrary } from '../../src/server/demo/library';
import { agentChat } from '../../src/server/agent/chat';
import { approvalMessage } from '../../src/components/shell/checks-model';

let db: TestDatabase;
const owner = 'd0000000-0000-4000-8000-000000000011';
const reviewer = 'd0000000-0000-4000-8000-000000000012';
const viewer = 'd0000000-0000-4000-8000-000000000013';
beforeAll(async () => { db = await testDatabase(); await installDemoLibrary(db.driver, db.driver); }, 90000);
afterAll(async () => { await db?.close(); });

it('lets one person start a Quick check in their own workspace: Nazir proposes, the person approves', async () => {
  const proposed = await agentChat(db.driver, owner, { message: 'run a quick check' }, null);
  expect(JSON.stringify(proposed), 'proposal').toContain('"done":true');
  const planId = (proposed.data as { id: string }).id;
  const plan = (await db.owner.query<{ proposed_by_type: string; proposed_by: string | null; status: string }>('SELECT proposed_by_type,proposed_by,status FROM nazir.plans WHERE id=$1', [planId])).rows[0]!;
  expect(plan).toEqual({ proposed_by_type: 'nazir', proposed_by: null, status: 'proposed' });
  const audit = (await db.owner.query<{ payload: { requested_by: string } }>("SELECT payload FROM nazir.audit_events WHERE action='plan.proposed' AND target_id=$1", [planId])).rows[0]!;
  expect(audit.payload.requested_by).toBe(owner);
  const started = await agentChat(db.driver, owner, { message: approvalMessage(planId, 'en') }, null);
  expect(JSON.stringify(started.reply.en), 'start').toContain('queued');
  expect((await db.owner.query("SELECT count(*)::int AS n FROM nazir.runs WHERE idempotency_key=$1", [`bounded:${planId}`])).rows[0]).toEqual({ n: 1 });
});

it('still refuses a viewer, and still keeps other plans proposed by a member', async () => {
  await expect(agentChat(db.driver, viewer, { message: 'run a quick check' }, null)).rejects.toThrow();
  const custom = await agentChat(db.driver, reviewer, { message: 'propose a plan 24 calls' }, null);
  const id = (custom.data as { id?: string } | null)?.id;
  if (id) expect((await db.owner.query<{ proposed_by_type: string }>('SELECT proposed_by_type FROM nazir.plans WHERE id=$1', [id])).rows[0]!.proposed_by_type).toBe('member');
});

it('refuses a solo real account direct Start until its current connection has answered', async () => {
  const user = (await db.owner.query<{ id: string }>("INSERT INTO nazir.users(email,name) VALUES('solo-connect@example.test','Omar') RETURNING id")).rows[0]!.id;
  const { ensureHomeWorkspace } = await import('../../src/server/auth/workspaces');
  const workspace_id = await ensureHomeWorkspace(db.driver, user);
  const member_id = (await db.owner.query<{ id: string }>('SELECT id FROM nazir.members WHERE workspace_id=$1', [workspace_id])).rows[0]!.id;
  const a = { workspace_id, member_id };
  const propose = await agentChat(db.driver, a.member_id, { message: 'run a quick check' }, null);
  const plan = (propose.data as { id: string }).id;
  await expect(agentChat(db.driver, a.member_id, { message: approvalMessage(plan, 'en') }, null)).resolves.toMatchObject({ done: false, data: { error: { code: 'external_not_ready' } } });
  const { saveExternalAgent, testExternalAgent } = await import('../../src/server/settings/external-agent');
  const resolve = async () => [{ address: '93.184.215.14' }];
  await saveExternalAgent(db.driver, a.member_id, { endpoint: 'https://agent.example.com/chat', format: 'simple_json' }, undefined, resolve);
  await expect(agentChat(db.driver, a.member_id, { message: approvalMessage(plan, 'en') }, null)).resolves.toMatchObject({ done: false, data: { error: { code: 'external_not_ready' } } });
  await testExternalAgent(db.driver, a.member_id, { message: 'Hello', language: 'en' }, { resolve, fetcher: async () => Response.json({ reply: 'Hello Omar' }) });
  const started = await agentChat(db.driver, a.member_id, { message: approvalMessage(plan, 'en') }, null);
  expect(started.done).toBe(true); expect(started.data).toHaveProperty('run_id');
});
