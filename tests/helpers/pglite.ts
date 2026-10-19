import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../src/server/db/migrate';
import { withMember, withWorker } from '../../src/server/db/context';
import type { SqlConnection, TransactionDriver } from '../../src/server/db/driver';

export async function testDatabase() {
  const pg = new PGlite();
  const wrap = (db: Pick<PGlite, 'query' | 'exec'>): SqlConnection => ({
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (params) return db.query<T>(sql, params);
      const results = await db.exec(sql);
      return { rows: (results.at(-1)?.rows ?? []) as T[] };
    },
  });
  const owner = wrap(pg);
  const driver: TransactionDriver = { transaction: (work) => pg.transaction((tx) => work(wrap(tx))) };
  const migrations = await migrate(driver);
  return {
    pg, owner, driver, migrations,
    member: <T>(id: string, work: (db: SqlConnection) => Promise<T>) => withMember(driver, id, work),
    worker: <T>(id: string, work: (db: SqlConnection) => Promise<T>) => withWorker(driver, id, work),
    async bootstrap(label: string) {
      return driver.transaction(async (db) => {
        await db.query('SET LOCAL ROLE nazir_worker');
        const result = await db.query<{ member_id: string; workspace_id: string }>(
          "SELECT * FROM nazir.bootstrap_workspace($1,$2,$2,'demo')", [`${label}@example.test`, label]);
        return result.rows[0]!;
      });
    },
    close: () => pg.close(),
  };
}
export type TestDatabase = Awaited<ReturnType<typeof testDatabase>>;

/** Seed a complete related graph in one workspace, with at least one row per table. */
export async function seed(db: TestDatabase, label: string) {
  const identity = await db.bootstrap(label);
  const w = identity.workspace_id;
  const m = identity.member_id;
  const ids: Record<string, string> = { members: m, workspaces: w };
  async function insert(table: string, values: Record<string, unknown>) {
    const fields = { workspace_id: w, ...values };
    const params = Object.values(fields).map((v) => v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v);
    const rows = await db.owner.query<{ id: string }>(`INSERT INTO nazir.${table}(${Object.keys(fields).join(',')}) VALUES(${params.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, params);
    ids[table] = rows.rows[0]!.id;
    return rows.rows[0]!.id;
  }
  await insert('rule_packs', { key: label, title: label });
  await insert('rule_pack_versions', { rule_pack_id: ids.rule_packs, version: 1, content: { rule: 'fictional' } });
  await insert('agents', { name: label });
  await insert('agent_versions', { agent_id: ids.agents, label: 'baseline', kind: 'baseline', config: {} });
  await insert('adapters', { agent_id: ids.agents, kind: 'built_in', tool_manifest: {} });
  await insert('scenario_meanings', { family: 'test', canonical: {} });
  await insert('scenarios', { meaning_id: ids.scenario_meanings, stable_key: label, version: 1, family: 'test', language: 'en', split: 'development', persona: {}, starting_state: {}, allowed_actions: [], forbidden_actions: [], expected_state: {}, source_clause: 'fictional', expectation_kind: 'fictional_demo_rule', severity: 'high', rubric_version: '1' });
  await insert('plans', { goal: 'test', agent_version_id: ids.agent_versions, rule_pack_version_id: ids.rule_pack_versions, families: ['test'], languages: ['en'], repeats: 1, budget_calls: 10, stop_rules: {}, proposed_by_type: 'member', proposed_by: m });
  await insert('runs', { plan_id: ids.plans, agent_version_id: ids.agent_versions, rule_pack_version_id: ids.rule_pack_versions, frozen_manifest: {}, runner_version: '1' });
  await insert('conversations', { run_id: ids.runs, scenario_id: ids.scenarios, language: 'en', idempotency_key: 'first' });
  await insert('conversation_messages', { conversation_id: ids.conversations, seq: 1, speaker: 'resident', body: 'مرحبا' });
  await insert('tool_events', { conversation_id: ids.conversations, seq: 1, tool_name: 'test', request: {}, response: {}, outcome: 'ok', idempotency_key: 'first' });
  await insert('state_readings', { conversation_id: ids.conversations, source: 'inspection_channel', reading: {} });
  await insert('findings', { run_id: ids.runs, conversation_id: ids.conversations, scenario_id: ids.scenarios, check_layer: 'deterministic', title: 'test', agent_said: 'said', really_happened: 'record', rule_pack_version_id: ids.rule_pack_versions, rule_clause: '1', agent_version_id: ids.agent_versions, severity: 'high', root_cause_class: 'unknown', owner_role: 'service_owner', evidence: {} });
  await insert('proposals', { finding_id: ids.findings, proposed_by_type: 'member', proposed_by: m, evidence: 'test' });
  await insert('approvals', { subject_type: 'plan', subject_id: ids.plans, decision: 'approve', reason: 'Reviewed', decided_by: m, decided_by_name_at_event: label, decided_by_roles_at_event: ['service_owner'] });
  await insert('lessons', { text: 'test', scope: 'small', created_by_type: 'nazir' });
  await insert('lesson_revisions', { lesson_id: ids.lessons, version: 1, text_after: 'test', status_after: 'active', changed_by: m });
  return { ...identity, ids, insert };
}
