import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { ensureHomeWorkspace } from '../../src/server/auth/workspaces';
import { agentChat } from '../../src/server/agent/chat';
import { approvalMessage } from '../../src/components/shell/checks-model';
import { ensureStarterLibrary } from '../../src/server/library/starter';

let db: TestDatabase;
let wid: string;
let owner: string;
let viewer: string;
beforeAll(async () => {
  db = await testDatabase();
  const user = (await db.owner.query<{ id: string }>("INSERT INTO nazir.users(email,name) VALUES('real.owner@example.test','Real Owner') RETURNING id")).rows[0]!.id;
  wid = await ensureHomeWorkspace(db.driver, user);
  owner = (await db.owner.query<{ id: string }>('SELECT id FROM nazir.members WHERE workspace_id=$1', [wid])).rows[0]!.id;
  viewer = await db.createMember(wid, ['viewer'], 'Watcher');
}, 60000);
afterAll(async () => { await db?.close(); });
const count = async (sql: string) => Number((await db.owner.query<{ n: string }>(sql, [wid])).rows[0]!.n);

it('a new workspace starts with no approved tests or rules', async () => {
  expect(await count("SELECT count(*) AS n FROM nazir.scenarios WHERE workspace_id=$1 AND status='approved'")).toBe(0);
  expect(await count("SELECT count(*) AS n FROM nazir.rule_pack_versions WHERE workspace_id=$1")).toBe(0);
});

it('one owner starts a first Quick check on their own: tests and rules are installed, Nazir proposes, the owner approves, the run is queued', async () => {
  const proposed = await agentChat(db.driver, owner, { message: 'run a quick check' }, null);
  expect(JSON.stringify(proposed.reply)).toContain('plan');
  const planId = (proposed.data as { id: string }).id;
  expect(await count("SELECT count(*) AS n FROM nazir.scenarios WHERE workspace_id=$1 AND status='approved' AND library_hash IS NOT NULL")).toBeGreaterThanOrEqual(48);
  expect(await count("SELECT count(*) AS n FROM nazir.rule_pack_versions WHERE workspace_id=$1 AND status='approved'")).toBe(1);
  expect(await count("SELECT count(*) AS n FROM nazir.audit_events WHERE workspace_id=$1 AND action='library.starter_installed'")).toBe(1);
  await expect(agentChat(db.driver, owner, { message: approvalMessage(planId, 'en') }, null)).resolves.toMatchObject({ done: false, data: { error: { code: 'external_not_ready' } } });
  const { saveExternalAgent, testExternalAgent } = await import('../../src/server/settings/external-agent');
  const resolve = async () => [{ address: '93.184.215.14' }];
  await saveExternalAgent(db.driver, owner, { endpoint: 'https://agent.example.com/chat', format: 'simple_json' }, undefined, resolve);
  await testExternalAgent(db.driver, owner, { message: 'Hello', language: 'en' }, { resolve, fetcher: async () => Response.json({ reply: 'Hello Omar' }) });
  const started = await agentChat(db.driver, owner, { message: approvalMessage(planId, 'en') }, null);
  expect(started.reply.en).toContain('queued');
  expect(started.reply.en).not.toContain('No test run was queued');
  expect(await count("SELECT count(*) AS n FROM nazir.runs WHERE workspace_id=$1 AND status IN ('queued','running')")).toBe(1);
});

it('does nothing the second time, and a viewer can never cause it', async () => {
  expect(await ensureStarterLibrary(db.driver, owner)).toBe(0);
  await expect(ensureStarterLibrary(db.driver, viewer)).rejects.toThrow();
  expect(await count("SELECT count(*) AS n FROM nazir.audit_events WHERE workspace_id=$1 AND action='library.starter_installed'")).toBe(1);
});

it('the install function refuses a member and a workspace of someone else', async () => {
  await expect(db.member(owner, (sql) => sql.query("SELECT nazir.worker_install_starter($1,'{}'::jsonb,'[{}]'::jsonb)", [owner]))).rejects.toThrow();
  const other = await db.bootstrap('someone-else');
  await expect(db.worker(other.workspace_id, (sql) => sql.query("SELECT nazir.worker_install_starter($1,'{}'::jsonb,'[{}]'::jsonb)", [owner]))).rejects.toThrow('Owner required');
});
