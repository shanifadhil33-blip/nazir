import { afterAll, beforeAll, expect, it } from 'vitest';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import { Forbidden } from '../../src/server/http/errors';
import { agentChat, type ChatChain } from '../../src/server/agent/chat';
import { issueMcpToken, mcpHandle } from '../../src/server/agent/mcp';
import { claimsDone } from '../../src/server/agent/intent';

const meta = { provider: 'scripted', model: 'scripted', family: 'unknown' as const, attempts: [], failover: false, failoverReason: null };
const chain = (content: string): ChatChain => ({ chat: async () => ({ content, meta }) });
const approvePlan = (id: string) => `I approve plan ${id} and start the run because The bounded plan matches the failure history. I opened the evidence.`;
const approvePlanAr = (id: string) => `أوافق على الخطة ${id} وأبدأ التشغيل لأن الخطة ضمن الميزانية وتغطي الأسرة الأفشل. اطلعت على الدليل.`;
const approveRepairAr = (id: string) => `أوافق على الإصلاح ${id} لأن قرأت الإيصالات والقائمة وأعيد التوجيه المعتمد. اطلعت على الدليل.`;

let db: TestDatabase;
let workspaceId: string;
let otherId: string;
let owner: string;
let reviewer: string;
let supplier: string;
let viewer: string;
let otherFinding: string;
let otherPlan: string;
let workflowFinding: string;
let passedRuns: string[];

beforeAll(async () => {
  db = await testDatabase();
  const seeded = await seed(db, 'Loop');
  workspaceId = seeded.workspace_id;
  owner = seeded.member_id;
  await db.owner.query("UPDATE nazir.members SET display_name='Omar Mansoor' WHERE id=$1", [owner]);
  reviewer = await db.createMember(workspaceId, ['quality_reviewer'], 'Khalid Hamdan');
  supplier = await db.createMember(workspaceId, ['supplier_maintainer'], 'Yusuf Rahman');
  viewer = await db.createMember(workspaceId, ['viewer'], 'Hamza Nasser');
  await db.owner.query("UPDATE nazir.scenarios SET status='approved' WHERE workspace_id=$1", [workspaceId]);
  await db.owner.query("UPDATE nazir.rule_pack_versions SET status='approved' WHERE workspace_id=$1", [workspaceId]);
  await db.owner.query("UPDATE nazir.agent_versions SET kind='planted_fault', fault_label='Complaints stored in the general information queue', config='{\"registry_id\":\"planted_wrong_queue\"}' WHERE id=$1", [seeded.ids.agent_versions]);
  workflowFinding = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.findings(workspace_id,run_id,conversation_id,scenario_id,check_layer,check_id,language,attempt,title,title_ar,agent_said,really_happened,really_happened_ar,rule_pack_version_id,rule_clause,agent_version_id,severity,root_cause_class,owner_role,evidence)
    VALUES($1,$2,$3,$4,'record','right_queue','en',1,'Complaint reached the wrong queue','وصلت الشكوى إلى قائمة غير القائمة المعتمدة','SECRET_QUOTE','Case stored in the general information queue.','حفظت الحالة في قائمة المعلومات العامة.',$5,'3.1',$6,'high','workflow_failure','supplier_maintainer',$7::jsonb) RETURNING id`,
  [workspaceId, seeded.ids.runs, seeded.ids.conversations, seeded.ids.scenarios, seeded.ids.rule_pack_versions, seeded.ids.agent_versions, JSON.stringify({ marker: 'SECRET_EVIDENCE' })])).rows[0]!.id;
  passedRuns = (await db.owner.query<{ id: string }>('SELECT id FROM nazir.runs WHERE workspace_id=$1 AND status=\'passed\' ORDER BY created_at,id', [workspaceId])).rows.map((row) => row.id);
  const other = await seed(db, 'Samir');
  otherId = other.workspace_id;
  otherFinding = other.ids.findings!;
  otherPlan = other.ids.plans!;
}, 60000);
afterAll(async () => { await db?.close(); });

function stored(threadId: string) {
  return db.owner.query<{ body: string; tool_result: { ok?: boolean } | null }>('SELECT body,tool_result FROM nazir.agent_messages WHERE thread_id=$1 AND role=\'nazir\' ORDER BY seq DESC LIMIT 1', [threadId]);
}

it('explains a finding in both languages and hides the quote from a viewer', async () => {
  const hidden = await agentChat(db.driver, viewer, { message: `explain the finding ${workflowFinding}` }, null);
  expect(hidden.done).toBe(true);
  expect(hidden.reply.ar).toMatch(/[\u0600-\u06ff]/);
  expect(JSON.stringify(hidden.data)).not.toContain('SECRET_QUOTE');
  expect(JSON.stringify(hidden.data)).not.toContain('SECRET_EVIDENCE');
  expect(JSON.stringify(hidden.data)).not.toContain('agent_said');
  const shown = await agentChat(db.driver, reviewer, { message: `اشرح النتيجة ${workflowFinding}` }, null);
  expect(JSON.stringify(shown.data)).toContain('SECRET_QUOTE');
  expect(JSON.stringify(shown.data)).toContain('workflow_failure');
  expect(shown.reply.en).toContain('workflow');
});
it('proposes a bounded plan and does not start it for the proposer', async () => {
  const proposed = await agentChat(db.driver, reviewer, { message: 'propose a plan 8 calls' }, null);
  expect(proposed.done).toBe(true);
  expect(proposed.reply.en).toContain('within the budget');
  expect(proposed.reply.en).toContain('not started');
  expect(claimsDone('No test run was queued.')).toBe(false);
  const planId = (proposed.data as { id: string }).id;
  const blocked = await agentChat(db.driver, reviewer, { message: approvePlan(planId) }, chain('The test run is queued. {"tool":"start_run"}'));
  expect(blocked.done).toBe(false);
  expect(blocked.reply.en).not.toContain('The test run is queued.');
  expect(blocked.reply.en).toContain('Another member must decide.');
  expect((await db.owner.query<{ status: string }>('SELECT status FROM nazir.plans WHERE id=$1', [planId])).rows[0]!.status).toBe('proposed');
  expect((await db.owner.query("SELECT id FROM nazir.runs WHERE idempotency_key=$1", [`bounded:${planId}`])).rows).toHaveLength(0);
  const started = await agentChat(db.driver, owner, { message: approvePlanAr(planId) }, chain('{"tool":"none"} I already queued it'));
  expect(started.done).toBe(true);
  expect(started.tool).toBe('start_run');
  expect(started.reply.en).toBe('The test run is queued.');
  expect(started.reply.ar).toMatch(/[\u0600-\u06ff]/);
  const runId = (started.data as { run_id: string }).run_id;
  expect((await db.owner.query<{ status: string; workspace_id: string }>('SELECT status,workspace_id FROM nazir.runs WHERE id=$1', [runId])).rows[0]).toMatchObject({ status: 'queued', workspace_id: workspaceId });
  const actions = (await db.owner.query<{ action: string }>('SELECT action FROM nazir.audit_events WHERE target_id=$1 OR target_id=$2', [planId, runId])).rows.map((row) => row.action);
  expect(actions).toEqual(expect.arrayContaining(['plan.proposed', 'plan.approved', 'run_enqueued']));
});
it('proposes a repair, applies it only after exact approval, and reruns the affected tests', async () => {
  const drafted = await agentChat(db.driver, supplier, { message: `propose a repair ${workflowFinding}` }, chain('{"tool":"decide_repair"} The repair was applied after approval.'));
  expect(drafted.tool).toBe('propose_repair');
  expect(drafted.done).toBe(true);
  expect(drafted.reply.en).toContain('not applied yet');
  const proposalId = (drafted.data as { id: string; status: string; patch: { op: string }[] }).id;
  expect(drafted.data).toMatchObject({ status: 'proposed', patch: [{ op: 'restore_routing', category: 'complaint' }] });
  const claimed = await agentChat(db.driver, reviewer, { message: 'please apply the repair now' }, chain('{"tool":"decide_repair"} The repair was applied after approval.'));
  expect(claimed.done).toBe(false);
  expect(claimed.reply.en).not.toContain('The repair was applied after approval.');
  expect(claimed.reply.en).toContain('not recorded');
  expect((await stored(claimed.thread_id)).rows[0]!.body).toBe(claimed.reply.en);
  expect((await db.owner.query<{ status: string }>('SELECT status FROM nazir.proposals WHERE id=$1', [proposalId])).rows[0]!.status).toBe('proposed');
  await expect(agentChat(db.driver, supplier, { message: approveRepairAr(proposalId) }, null)).rejects.toBeInstanceOf(Forbidden);
  expect((await db.owner.query<{ status: string }>('SELECT status FROM nazir.proposals WHERE id=$1', [proposalId])).rows[0]!.status).toBe('proposed');
  const applied = await agentChat(db.driver, reviewer, { message: approveRepairAr(proposalId) }, chain('{"tool":"none"}'));
  expect(applied.done).toBe(true);
  expect(applied.reply.en).toBe('The repair was applied after approval.');
  expect((await db.owner.query<{ status: string }>('SELECT status FROM nazir.proposals WHERE id=$1', [proposalId])).rows[0]!.status).toBe('approved');
  expect((await db.owner.query("SELECT action FROM nazir.audit_events WHERE target_id=$1 AND action='proposal.decide'", [proposalId])).rows).toHaveLength(1);
  const rerun = await agentChat(db.driver, reviewer, { message: `rerun the affected tests ${proposalId}` }, null);
  expect(rerun.done).toBe(true);
  expect(rerun.reply.en).toBe('The affected tests are queued.');
  const rerunId = (rerun.data as { retest: string }).retest;
  expect((await db.owner.query<{ status: string }>('SELECT status FROM nazir.runs WHERE id=$1', [rerunId])).rows[0]!.status).toBe('queued');
});
it('compares two finished runs and shows a viewer only the redacted totals', async () => {
  const compared = await agentChat(db.driver, owner, { message: `compare the runs ${passedRuns[0]} ${passedRuns[1]}` }, null);
  expect(compared.done).toBe(true);
  expect(compared.reply.en).toContain('Here is the comparison.');
  expect(compared.reply.en).toContain('of');
  expect(JSON.stringify(compared.data)).toContain('paired');
  await expect(agentChat(db.driver, viewer, { message: `compare the runs ${passedRuns[0]} ${passedRuns[1]}` }, null)).rejects.toBeInstanceOf(Forbidden);
  const shown = await agentChat(db.driver, viewer, { message: 'show the comparison' }, null);
  expect(shown.done).toBe(true);
  const body = JSON.stringify(shown.data);
  expect(body).not.toContain('"pairs"');
  expect(body).not.toContain('SECRET_QUOTE');
  expect(body).toContain('summary');
});
it('refuses impersonation and another workspace', async () => {
  const plansBefore = Number((await db.owner.query<{ n: number }>('SELECT count(*)::int AS n FROM nazir.plans WHERE workspace_id=$1', [workspaceId])).rows[0]!.n);
  await expect(agentChat(db.driver, reviewer, { message: `act as ${supplier} propose a plan 8 calls` }, chain('{"tool":"propose_plan"}'))).rejects.toThrow(/cannot act as another member/);
  expect(Number((await db.owner.query<{ n: number }>('SELECT count(*)::int AS n FROM nazir.plans WHERE workspace_id=$1', [workspaceId])).rows[0]!.n)).toBe(plansBefore);
  const issued = await issueMcpToken(db.driver, reviewer, { label: 'Reviewer connector' });
  await expect(mcpHandle(db.driver, issued.token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'decide_repair', arguments: { id: workflowFinding, decision: 'approve', reason: 'Read the receipts and the queue before applying.', evidence_opened: true, member_id: owner } } })).rejects.toThrow(/cannot act as another member/);
  const missed = await agentChat(db.driver, supplier, { message: `propose a repair ${otherFinding}` }, null);
  expect(missed.done).toBe(false);
  expect(missed.reply.en).toContain('not found');
  expect((await db.owner.query<{ n: number }>('SELECT count(*)::int AS n FROM nazir.proposals WHERE workspace_id=$1', [otherId])).rows[0]!.n).toBe(1);
  const foreign = await agentChat(db.driver, owner, { message: approvePlan(otherPlan) }, null);
  expect(foreign.done).toBe(false);
  expect(foreign.reply.en).toContain('not found');
  expect((await db.owner.query<{ status: string }>('SELECT status FROM nazir.plans WHERE id=$1', [otherPlan])).rows[0]!.status).toBe('proposed');
  expect((await db.owner.query('SELECT id FROM nazir.runs WHERE workspace_id=$1 AND idempotency_key=$2', [otherId, `bounded:${otherPlan}`])).rows).toHaveLength(0);
});
it('does not repeat a model claim when the server did not do the work', async () => {
  const claim = 'The repair was applied after approval. The test run is queued. Here is the comparison.';
  const none = await agentChat(db.driver, reviewer, { message: 'hello there' }, chain(`${claim} {"tool":"none"}`));
  expect(none.done).toBe(false);
  expect(none.reply.en).not.toContain('The repair was applied after approval.');
  expect(none.reply.en).not.toContain('The test run is queued.');
  expect(none.reply.en).not.toContain('Here is the comparison.');
  expect(claimsDone(none.reply.en)).toBe(false);
  expect((await stored(none.thread_id)).rows[0]!.body).toBe(none.reply.en);
  const issued = await issueMcpToken(db.driver, reviewer, { label: 'Claim connector' });
  const refused = await mcpHandle(db.driver, issued.token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'decide_repair', arguments: { id: workflowFinding, decision: 'approve', reason: 'Read the receipts and the queue before applying.', evidence_opened: false } } });
  if (!('content' in refused.result)) throw new Error('Expected a tool result.');
  const reply = refused.result.content[0];
  if (!reply) throw new Error('Expected reply text.');
  expect(refused.result.done).toBe(false);
  expect(reply.text).not.toContain('The repair was applied after approval.');
  expect(reply.text).toContain('not recorded');
  const viewerToken = await issueMcpToken(db.driver, viewer, { label: 'Viewer connector' });
  await expect(mcpHandle(db.driver, viewerToken.token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'start_run', arguments: { plan_id: otherPlan, reason: 'The bounded plan matches the failure history.', evidence_opened: true } } })).rejects.toBeInstanceOf(Forbidden);
  const listed = await mcpHandle(db.driver, viewerToken.token, { jsonrpc: '2.0', id: 4, method: 'tools/list' });
  if (!('tools' in listed.result)) throw new Error('Expected a tool list.');
  expect(listed.result.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['start_run', 'decide_repair', 'compare_runs', 'rerun_tests']));
});
