import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';

let db: TestDatabase;
let a: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => { db = await testDatabase(); a = await seed(db, 'Content'); });
afterAll(async () => { await db?.close(); });
it('hashes database JSON text and freezes approved rule versions', async () => {
  const row = (await db.owner.query<{ content: string; content_hash: string }>('SELECT content::text,content_hash FROM nazir.rule_pack_versions WHERE id=$1', [a.ids.rule_pack_versions])).rows[0]!;
  expect(row.content_hash).toBe(createHash('sha256').update(row.content).digest('hex'));
  await db.member(a.member_id, (sql) => sql.query("UPDATE nazir.rule_pack_versions SET status='approved' WHERE id=$1", [a.ids.rule_pack_versions]));
  for (const change of ["content='{}'", 'version=2', "content_hash='fake'", "status='draft'"]) {
    await expect(db.member(a.member_id, (sql) => sql.query(`UPDATE nazir.rule_pack_versions SET ${change} WHERE id=$1`, [a.ids.rule_pack_versions]))).rejects.toThrow('Approved content is immutable');
  }
  await db.member(a.member_id, (sql) => sql.query("UPDATE nazir.rule_pack_versions SET status='retired' WHERE id=$1", [a.ids.rule_pack_versions]));
  await expect(db.owner.query("UPDATE nazir.rule_pack_versions SET content='{}' WHERE id=$1", [a.ids.rule_pack_versions])).rejects.toThrow('Approved content is immutable');
});
it('freezes approved scenarios and permits a new version with a different expected result', async () => {
  await db.owner.query("UPDATE nazir.scenarios SET status='approved' WHERE id=$1", [a.ids.scenarios]);
  await expect(db.member(a.member_id, (sql) => sql.query("UPDATE nazir.scenarios SET expected_state='{\"changed\":true}' WHERE id=$1", [a.ids.scenarios]))).rejects.toThrow('Approved content is immutable');
  await db.member(a.member_id, (sql) => sql.query(`INSERT INTO nazir.scenarios SELECT (jsonb_populate_record(NULL::nazir.scenarios,
    (SELECT to_jsonb(s) FROM nazir.scenarios s WHERE id=$1) || jsonb_build_object('id',gen_random_uuid(),'version',2,'status','draft','expected_state','{"changed":true}'::jsonb))).*`, [a.ids.scenarios]));
  const rows = (await db.owner.query('SELECT version,expected_state FROM nazir.scenarios ORDER BY version')).rows;
  expect(rows).toEqual([{ version: 1, expected_state: {} }, { version: 2, expected_state: { changed: true } }]);
  const hash = (await db.owner.query('SELECT content_hash FROM nazir.scenarios WHERE id=$1', [a.ids.scenarios])).rows[0]!.content_hash;
  await db.driver.transaction(async (sql) => {
    await sql.query("SET LOCAL TIME ZONE 'Asia/Dubai'");
    const result = await sql.query("UPDATE nazir.scenarios SET status='retired' WHERE id=$1 RETURNING content_hash", [a.ids.scenarios]);
    expect(result.rows[0]!.content_hash).toBe(hash);
  });
});
it('freezes agent versions and requires planted fault labels', async () => {
  await db.owner.query('UPDATE nazir.agent_versions SET frozen_at=now() WHERE id=$1', [a.ids.agent_versions]);
  await expect(db.owner.query("UPDATE nazir.agent_versions SET config='{\"changed\":true}' WHERE id=$1", [a.ids.agent_versions])).rejects.toThrow('Frozen version is immutable');
  await expect(a.insert('agent_versions', { agent_id: a.ids.agents, label: 'fault', kind: 'planted_fault', config: {} })).rejects.toThrow(/check constraint/);
});
it('keeps run manifests immutable while status progresses', async () => {
  await expect(db.worker(a.workspace_id, (sql) => sql.query("UPDATE nazir.runs SET frozen_manifest='{\"changed\":true}' WHERE id=$1", [a.ids.runs]))).rejects.toThrow('Manifest is immutable');
  await expect(db.owner.query("UPDATE nazir.runs SET manifest_hash='fake' WHERE id=$1", [a.ids.runs])).rejects.toThrow('Manifest is immutable');
  await db.worker(a.workspace_id, (sql) => sql.query("UPDATE nazir.runs SET status='running' WHERE id=$1", [a.ids.runs]));
});
it('freezes all finding fields except status and owner role', async () => {
  for (const change of ["agent_said='changed'", "really_happened='changed'", "evidence='{}'::jsonb || '{\"changed\":true}'", "rule_clause='changed'", "check_layer='human'", "title='changed'", "severity='low'"]) {
    await expect(db.owner.query(`UPDATE nazir.findings SET ${change} WHERE id=$1`, [a.ids.findings])).rejects.toThrow('Finding evidence is immutable');
  }
  await db.member(a.member_id, (sql) => sql.query("UPDATE nazir.findings SET status='accepted',owner_role='viewer' WHERE id=$1", [a.ids.findings]));
  await db.worker(a.workspace_id, (sql) => sql.query("UPDATE nazir.findings SET status='retest_passed' WHERE id=$1", [a.ids.findings]));
  await expect(db.worker(a.workspace_id, (sql) => sql.query("UPDATE nazir.findings SET owner_role='service_owner' WHERE id=$1", [a.ids.findings]))).rejects.toThrow(/permission denied/);
});
it('rejects updates and deletes on each append only evidence table', async () => {
  for (const table of ['conversation_messages', 'tool_events', 'state_readings', 'approvals', 'lesson_revisions']) {
    for (const command of [`UPDATE nazir.${table} SET id=id`, `DELETE FROM nazir.${table}`]) {
      await expect(db.owner.query(command), command).rejects.toThrow('Append only record');
    }
  }
});
it('rejects duplicate conversation and tool event idempotency keys', async () => {
  await expect(a.insert('conversations', { run_id: a.ids.runs, scenario_id: a.ids.scenarios, language: 'ar', idempotency_key: 'first' })).rejects.toThrow(/unique constraint/);
  await expect(a.insert('tool_events', { conversation_id: a.ids.conversations, seq: 2, tool_name: 'test', request: {}, response: {}, outcome: 'ok', idempotency_key: 'first' })).rejects.toThrow(/unique constraint/);
  await a.insert('tool_events', { conversation_id: a.ids.conversations, seq: 2, tool_name: 'test', request: {}, response: {}, outcome: 'ok', idempotency_key: null });
  await a.insert('tool_events', { conversation_id: a.ids.conversations, seq: 3, tool_name: 'test', request: {}, response: {}, outcome: 'ok', idempotency_key: null });
});
it('requires a meaningful approval reason', async () => {
  for (const reason of ['', '  ', 'ab', null]) {
    await expect(a.insert('approvals', { subject_type: 'plan', subject_id: a.ids.plans, decision: 'approve', reason, decided_by: a.member_id, decided_by_name_at_event: 'Member', decided_by_roles_at_event: ['service_owner'] })).rejects.toThrow(/check constraint|not-null constraint/);
  }
});
