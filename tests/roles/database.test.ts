import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { roles, type Role } from '../../src/server/auth/roles';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
let db: TestDatabase;
let a: Awaited<ReturnType<typeof seed>>;
let b: Awaited<ReturnType<typeof seed>>;
const members = {} as Record<Role, string>;
let counter = 100;
beforeAll(async () => {
  db = await testDatabase(); a = await seed(db, 'DatabaseRoles'); b = await seed(db, 'Separate');
  for (const role of roles) members[role] = await db.createMember(a.workspace_id, [role]);
});
afterAll(async () => { await db?.close(); });
async function rowCopy(table: string, changes: Record<string, unknown> = {}) {
  const row = (await db.owner.query<{ row: Record<string, unknown> }>(`SELECT to_jsonb(t) AS row FROM nazir.${table} t WHERE id=$1`, [a.ids[table]])).rows[0]!.row;
  return { ...row, id: randomUUID(), ...(table === 'rule_packs' ? { key: randomUUID() } : {}), ...(['rule_pack_versions', 'scenarios', 'lesson_revisions'].includes(table) ? { version: counter++ } : {}), ...changes };
}
async function insertAs(member: string, table: string, changes: Record<string, unknown> = {}) {
  const row = await rowCopy(table, changes);
  return db.member(member, (sql) => sql.query(`INSERT INTO nazir.${table} SELECT (jsonb_populate_record(NULL::nazir.${table},$1::jsonb)).* RETURNING *`, [JSON.stringify(row)]));
}
async function updateDenied(member: string, query: string, params: unknown[]) {
  try { return (await db.member(member, (sql) => sql.query(query, params))).rows.length === 0; }
  catch (error) { expect(String(error)).toMatch(/required|must|security|immutable|denied/); return true; }
}
const writes: [string, Role[]][] = [
  ['adapters', ['supplier_maintainer']], ['agents', ['supplier_maintainer', 'service_owner']],
  ['agent_versions', ['supplier_maintainer', 'service_owner']], ['rule_packs', ['supplier_maintainer', 'service_owner']],
  ['rule_pack_versions', ['supplier_maintainer', 'service_owner']], ['scenarios', ['quality_reviewer', 'service_owner']],
  ['scenario_meanings', ['quality_reviewer', 'service_owner']], ['plans', ['quality_reviewer', 'service_owner']],
  ['proposals', ['supplier_maintainer']], ['lessons', ['quality_reviewer', 'service_owner']],
  ['lesson_revisions', ['quality_reviewer', 'service_owner']], ['findings', ['quality_reviewer']],
];
for (const [table, allowed] of writes) for (const role of roles) {
  it(`SQL insert ${table} as ${role}`, async () => {
    const result = insertAs(members[role], table);
    if (allowed.includes(role)) expect((await result).rows).toHaveLength(1);
    else await expect(result).rejects.toThrow(/required|security|denied/);
  });
}
for (const [table, allowed] of writes.filter(([table]) => !['findings', 'lesson_revisions', 'proposals'].includes(table))) for (const role of roles) {
  it(`SQL update ${table} as ${role}`, async () => {
    const query = `UPDATE nazir.${table} SET id=id WHERE id=$1 RETURNING id`;
    if (allowed.includes(role)) expect((await db.member(members[role], (sql) => sql.query(query, [a.ids[table]]))).rows).toHaveLength(1);
    else expect(await updateDenied(members[role], query, [a.ids[table]])).toBe(true);
  });
}
it('forces insert authors and keeps authors unchanged', async () => {
  for (const table of ['rule_pack_versions', 'scenarios', 'plans', 'agent_versions', 'adapters']) {
    const role = table === 'adapters' ? 'supplier_maintainer' : 'service_owner';
    const row = (await insertAs(members[role], table, { created_by: a.member_id })).rows[0]!;
    expect(row.created_by).toBe(members[role]);
    await expect(db.member(members[role], (sql) => sql.query(`UPDATE nazir.${table} SET created_by=$1 WHERE id=$2`, [a.member_id, row.id]))).rejects.toThrow('Author is immutable');
    if (table === 'plans') expect(row.proposed_by).toBe(members[role]);
  }
  const proposal = (await insertAs(members.supplier_maintainer, 'proposals', { proposed_by: a.member_id, proposed_by_type: 'nazir' })).rows[0]!;
  expect(proposal).toMatchObject({ proposed_by: members.supplier_maintainer, proposed_by_type: 'member' });
  await expect(db.member(members.supplier_maintainer, (sql) => sql.query('UPDATE nazir.proposals SET proposed_by=$1 WHERE id=$2', [a.member_id, proposal.id]))).rejects.toThrow('Author is immutable');
});
it('reserves planted fault inserts and updates for owners', async () => {
  await expect(insertAs(members.supplier_maintainer, 'agent_versions', { kind: 'planted_fault', fault_label: 'Demo fault' })).rejects.toThrow('Owner required');
  expect((await insertAs(members.service_owner, 'agent_versions', { kind: 'planted_fault', fault_label: 'Demo fault' })).rows).toHaveLength(1);
  await expect(db.member(members.supplier_maintainer, (sql) => sql.query("UPDATE nazir.agent_versions SET kind='planted_fault',fault_label='Demo' WHERE id=$1", [a.ids.agent_versions]))).rejects.toThrow('Owner required');
});
it('checks role and author for direct rule status approval and retirement', async () => {
  const row = (await insertAs(members.service_owner, 'rule_pack_versions')).rows[0]!;
  await expect(db.member(members.service_owner, (sql) => sql.query("UPDATE nazir.rule_pack_versions SET status='approved' WHERE id=$1", [row.id]))).rejects.toThrow('Another member');
  for (const status of ['approved', 'retired']) await expect(db.member(members.supplier_maintainer, (sql) => sql.query('UPDATE nazir.rule_pack_versions SET status=$1 WHERE id=$2', [status, row.id]))).rejects.toThrow('Owner required');
  expect((await db.member(a.member_id, (sql) => sql.query("UPDATE nazir.rule_pack_versions SET status='approved' WHERE id=$1 RETURNING approved_by", [row.id]))).rows).toEqual([{ approved_by: a.member_id }]);
  await expect(insertAs(members.service_owner, 'rule_pack_versions', { status: 'approved' })).rejects.toThrow('Another member');
});
it.each(['plans', 'scenarios'])('checks the author of %s on direct approval', async (table) => {
  const row = (await insertAs(members.quality_reviewer, table)).rows[0]!;
  await expect(db.member(members.quality_reviewer, (sql) => sql.query(`UPDATE nazir.${table} SET status='approved' WHERE id=$1`, [row.id]))).rejects.toThrow('Another member');
  expect((await db.member(members.service_owner, (sql) => sql.query(`UPDATE nazir.${table} SET status='approved' WHERE id=$1 RETURNING approved_by`, [row.id]))).rows).toEqual([{ approved_by: members.service_owner }]);
  await expect(insertAs(members.quality_reviewer, table, { status: 'approved' })).rejects.toThrow('Another member');
});
it('checks legacy plan proposers when no created_by was recorded', async () => {
  await expect(db.member(a.member_id, (sql) => sql.query("UPDATE nazir.plans SET status='approved' WHERE id=$1", [a.ids.plans]))).rejects.toThrow('Another member');
});
it('limits finding changes to reviewers or owner acceptance', async () => {
  for (const status of ['overridden', 'accepted', 'repair_proposed']) {
    expect((await db.member(members.quality_reviewer, (sql) => sql.query('UPDATE nazir.findings SET status=$1 WHERE id=$2 RETURNING id', [status, a.ids.findings]))).rows).toHaveLength(1);
    expect(await updateDenied(members.supplier_maintainer, 'UPDATE nazir.findings SET status=$1 WHERE id=$2 RETURNING id', [status, a.ids.findings])).toBe(true);
  }
  await expect(db.member(members.service_owner, (sql) => sql.query("UPDATE nazir.findings SET status='overridden' WHERE id=$1", [a.ids.findings]))).rejects.toThrow('Reviewer required');
  expect((await db.member(members.service_owner, (sql) => sql.query("UPDATE nazir.findings SET status='accepted' WHERE id=$1 RETURNING id", [a.ids.findings]))).rows).toHaveLength(1);
});
it('only owners activate big lessons while reviewers confirm small lessons', async () => {
  await expect(insertAs(members.quality_reviewer, 'lessons', { scope: 'big', status: 'active' })).rejects.toThrow('Owner required');
  const row = (await insertAs(members.quality_reviewer, 'lessons', { scope: 'big', status: 'waiting_approval' })).rows[0]!;
  await expect(db.member(members.quality_reviewer, (sql) => sql.query("UPDATE nazir.lessons SET status='active' WHERE id=$1", [row.id]))).rejects.toThrow('Owner required');
  expect((await db.member(members.service_owner, (sql) => sql.query("UPDATE nazir.lessons SET status='active' WHERE id=$1 RETURNING id", [row.id]))).rows).toHaveLength(1);
});
const approvalSubjects: [string, string, Role[]][] = [
  ['rule_pack_version', 'rule_pack_versions', ['service_owner']], ['release', 'runs', ['service_owner']],
  ['proposal', 'proposals', ['quality_reviewer']], ['finding_override', 'findings', ['quality_reviewer']],
  ['scenario', 'scenarios', ['quality_reviewer']], ['plan', 'plans', ['quality_reviewer', 'service_owner']],
  ['lesson', 'lessons', ['quality_reviewer', 'service_owner']],
];
for (const [subject, table, allowed] of approvalSubjects) for (const role of roles) it(`SQL approval ${subject} as ${role}`, async () => {
  const work = insertAs(members[role], 'approvals', { subject_type: subject, subject_id: a.ids[table], decided_by: members[role], decided_by_name_at_event: 'Forged', decided_by_roles_at_event: ['viewer'] });
  if (allowed.includes(role)) expect((await work).rows[0]).toMatchObject({ decided_by_name_at_event: 'Member', decided_by_roles_at_event: [role] });
  else await expect(work).rejects.toThrow(/required|security|denied/);
});
it('requires owner approval for a big lesson', async () => {
  const big = await a.insert('lessons', { text: 'Big', scope: 'big', created_by_type: 'nazir', status: 'waiting_approval' });
  await expect(insertAs(members.quality_reviewer, 'approvals', { subject_type: 'lesson', subject_id: big, decided_by: members.quality_reviewer })).rejects.toThrow('Owner required');
  expect((await insertAs(members.service_owner, 'approvals', { subject_type: 'lesson', subject_id: big, decided_by: members.service_owner })).rows).toHaveLength(1);
});
it('rejects spoofed deciders and cross workspace or missing approval subjects', async () => {
  await expect(insertAs(members.service_owner, 'approvals', { subject_type: 'release', subject_id: a.ids.runs, decided_by: a.member_id })).rejects.toThrow('Decision member mismatch');
  for (const id of [b.ids.runs, randomUUID()]) await expect(insertAs(members.service_owner, 'approvals', { subject_type: 'release', subject_id: id, decided_by: members.service_owner })).rejects.toThrow('Subject not found');
});
it.each(['rule_pack_versions', 'plans', 'scenarios'])('forbids own %s approval records even with combined roles', async (table) => {
  const both = await db.createMember(a.workspace_id, ['service_owner', 'quality_reviewer']);
  const row = (await insertAs(both, table)).rows[0]!;
  const subject = table === 'rule_pack_versions' ? 'rule_pack_version' : table === 'plans' ? 'plan' : 'scenario';
  await expect(insertAs(both, 'approvals', { subject_type: subject, subject_id: row.id, decided_by: both })).rejects.toThrow('Another member');
});
it('applies fluid roles without permitting self decisions in SQL', async () => {
  const both = await db.createMember(a.workspace_id, ['supplier_maintainer', 'quality_reviewer']);
  const own = (await insertAs(both, 'proposals')).rows[0]!;
  for (const decision of ['approve', 'reject']) await expect(insertAs(both, 'approvals', { subject_type: 'proposal', subject_id: own.id, decision, decided_by: both })).rejects.toThrow('Another member');
  await expect(db.member(both, (sql) => sql.query("UPDATE nazir.proposals SET status='approved' WHERE id=$1", [own.id]))).rejects.toThrow('Another reviewer');
  const other = (await insertAs(members.supplier_maintainer, 'proposals')).rows[0]!;
  expect((await insertAs(both, 'approvals', { subject_type: 'proposal', subject_id: other.id, decided_by: both })).rows).toHaveLength(1);
  expect((await db.member(both, (sql) => sql.query("UPDATE nazir.proposals SET status='approved' WHERE id=$1 RETURNING id", [other.id]))).rows).toHaveLength(1);
  await expect(db.member(members.supplier_maintainer, (sql) => sql.query("UPDATE nazir.proposals SET status='approved' WHERE id=$1", [a.ids.proposals]))).rejects.toThrow('Another reviewer');
});
it('does not grant workers approval writes and preserves worker evidence rights', async () => {
  await expect(db.worker(a.workspace_id, (sql) => sql.query(`INSERT INTO nazir.approvals SELECT * FROM nazir.approvals LIMIT 1`))).rejects.toThrow(/permission denied/);
  await db.worker(a.workspace_id, (sql) => sql.query("SELECT nazir.append_audit('worker.check',null,null,'{}')"));
  expect((await db.worker(a.workspace_id, (sql) => sql.query('SELECT * FROM nazir.tool_events'))).rows.length).toBeGreaterThan(0);
});
it('restricts viewer reads and audit calls while combining viewer with other roles', async () => {
  for (const table of ['workspaces', 'members', 'member_roles', 'rule_packs', 'agents', 'runs']) expect((await db.member(members.viewer, (sql) => sql.query(`SELECT * FROM nazir.${table}`))).rows.length, table).toBeGreaterThan(0);
  for (const table of ['findings', 'conversation_messages', 'tool_events', 'state_readings', 'adapters', 'agent_versions', 'scenarios', 'scenario_meanings', 'plans', 'proposals', 'lessons', 'lesson_revisions', 'audit_events', 'conversations']) {
    expect((await db.member(members.viewer, (sql) => sql.query(`SELECT * FROM nazir.${table}`))).rows, table).toHaveLength(0);
  }
  expect((await db.member(members.viewer, (sql) => sql.query('SELECT status FROM nazir.rule_pack_versions'))).rows.every((row) => row.status === 'approved')).toBe(true);
  expect((await db.member(members.viewer, (sql) => sql.query('SELECT subject_type FROM nazir.approvals'))).rows.every((row) => row.subject_type === 'release')).toBe(true);
  expect((await db.member(members.viewer, (sql) => sql.query('SELECT nazir.meaning_is_visible($1) AS visible', [a.ids.scenario_meanings]))).rows).toEqual([{ visible: false }]);
  await expect(db.member(members.viewer, (sql) => sql.query("SELECT nazir.append_audit('forged',null,null,'{}')"))).rejects.toThrow('Your role cannot do this.');
  await expect(db.member(members.viewer, (sql) => sql.query("SELECT nazir.append_audit_internal('forged',null,null,'{}')"))).rejects.toThrow(/permission denied/);
  const combined = await db.createMember(a.workspace_id, ['viewer', 'supplier_maintainer']);
  expect((await db.member(combined, (sql) => sql.query('SELECT * FROM nazir.tool_events'))).rows.length).toBeGreaterThan(0);
});
it('hides hidden scenarios and meanings from suppliers', async () => {
  const meaning = await a.insert('scenario_meanings', { family: 'hidden', canonical: { secret: true } });
  const hidden = await rowCopy('scenarios', { split: 'hidden', meaning_id: meaning });
  await db.owner.query('INSERT INTO nazir.scenarios SELECT (jsonb_populate_record(NULL::nazir.scenarios,$1::jsonb)).*', [JSON.stringify(hidden)]);
  for (const role of ['supplier_maintainer', 'quality_reviewer', 'service_owner'] as Role[]) {
    const visible = await db.member(members[role], (sql) => sql.query('SELECT split FROM nazir.scenarios WHERE id=$1 OR id=$2', [hidden.id, a.ids.scenarios]));
    expect(visible.rows).toHaveLength(role === 'supplier_maintainer' ? 1 : 2);
    expect((await db.member(members[role], (sql) => sql.query('SELECT * FROM nazir.scenario_meanings WHERE id=$1', [meaning]))).rows).toHaveLength(role === 'supplier_maintainer' ? 0 : 1);
  }
});
it('fails closed for removed members, missing context and non app roles', async () => {
  const member = await db.createMember(a.workspace_id, ['service_owner']);
  await db.owner.query("UPDATE nazir.members SET status='removed' WHERE id=$1", [member]);
  expect((await db.member(member, (sql) => sql.query("SELECT nazir.current_member_id() AS id,nazir.member_has_role('service_owner') AS role"))).rows).toEqual([{ id: null, role: false }]);
  expect((await db.owner.query("SELECT nazir.current_member_id() AS id,nazir.member_has_role('service_owner') AS role")).rows).toEqual([{ id: null, role: false }]);
  expect((await db.worker(a.workspace_id, (sql) => sql.query("SELECT nazir.current_member_id() AS id,nazir.member_has_role('service_owner') AS role"))).rows).toEqual([{ id: null, role: false }]);
  expect((await db.driver.transaction(async (sql) => { await sql.query('SET LOCAL ROLE nazir_app'); return sql.query("SELECT nazir.current_member_id() AS id,nazir.member_has_role('service_owner') AS role"); })).rows).toEqual([{ id: null, role: false }]);
});
it('confines member provisioning to workers in their workspace', async () => {
  await expect(db.member(members.service_owner, (sql) => sql.query("SELECT nazir.add_member('x@example.test','X',ARRAY['viewer'])"))).rejects.toThrow(/permission denied/);
  await expect(db.worker(a.workspace_id, (sql) => sql.query("SELECT nazir.add_member('x@example.test','X',ARRAY['admin'])"))).rejects.toThrow('Choose a role');
  const member = (await db.worker(a.workspace_id, (sql) => sql.query<{ id: string }>("SELECT nazir.add_member('provision@example.test','Provisioned',ARRAY['viewer']) AS id"))).rows[0]!.id;
  expect((await db.owner.query('SELECT workspace_id FROM nazir.members WHERE id=$1', [member])).rows).toEqual([{ workspace_id: a.workspace_id }]);
});
it('lets reviewers edit active big lessons without activating one', async () => {
  const id = await a.insert('lessons', { text: 'Original', scope: 'big', created_by_type: 'nazir', status: 'active' });
  expect((await db.member(members.quality_reviewer, (sql) => sql.query("UPDATE nazir.lessons SET text='Edited' WHERE id=$1 RETURNING text", [id]))).rows).toEqual([{ text: 'Edited' }]);
});
it('hides a meaning shared with hidden scenarios', async () => {
  const hidden = await rowCopy('scenarios', { split: 'hidden' });
  await db.owner.query('INSERT INTO nazir.scenarios SELECT (jsonb_populate_record(NULL::nazir.scenarios,$1::jsonb)).*', [JSON.stringify(hidden)]);
  expect((await db.member(members.supplier_maintainer, (sql) => sql.query('SELECT * FROM nazir.scenario_meanings WHERE id=$1', [a.ids.scenario_meanings]))).rows).toHaveLength(0);
});
it('does not let reviewers edit proposal evidence while deciding', async () => {
  const proposal = (await insertAs(members.supplier_maintainer, 'proposals')).rows[0]!;
  await expect(db.member(members.quality_reviewer, (sql) => sql.query("UPDATE nazir.proposals SET status='approved',evidence='Changed' WHERE id=$1", [proposal.id]))).rejects.toThrow('Supplier required');
});
it('keeps scenario hashes unchanged when retiring an approved row', async () => {
  const scenario = (await insertAs(members.quality_reviewer, 'scenarios')).rows[0]!;
  await db.member(members.service_owner, (sql) => sql.query("UPDATE nazir.scenarios SET status='approved' WHERE id=$1", [scenario.id]));
  const before = (await db.owner.query('SELECT content_hash FROM nazir.scenarios WHERE id=$1', [scenario.id])).rows[0];
  const after = (await db.member(members.service_owner, (sql) => sql.query("UPDATE nazir.scenarios SET status='retired' WHERE id=$1 RETURNING content_hash", [scenario.id]))).rows[0];
  expect(after).toEqual(before);
});
it('prevents forged approval metadata without a status transition', async () => {
  for (const table of ['rule_pack_versions', 'plans', 'scenarios']) {
    const row = (await insertAs(members.service_owner, table, { approved_by: a.member_id, approved_at: new Date().toISOString() })).rows[0]!;
    expect(row.approved_by).toBeNull(); expect(row.approved_at).toBeNull();
    await expect(db.member(members.service_owner, (sql) => sql.query(`UPDATE nazir.${table} SET approved_by=$1 WHERE id=$2`, [a.member_id, row.id]))).rejects.toThrow('Approval metadata is immutable');
  }
  const lesson = await a.insert('lessons', { text: 'Big lesson', scope: 'big', status: 'waiting_approval', created_by_type: 'nazir' });
  await expect(db.member(members.quality_reviewer, (sql) => sql.query('UPDATE nazir.lessons SET approved_by=$1 WHERE id=$2', [members.service_owner, lesson]))).rejects.toThrow('Owner required');
});
