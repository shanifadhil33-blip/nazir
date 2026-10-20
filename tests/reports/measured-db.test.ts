import { afterAll, beforeAll, expect, it } from 'vitest';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import { measuredResults } from '../../src/server/reports/measured';

let db: TestDatabase; let owner: string; let viewer: string; let outsider: string; let supplier: string;
beforeAll(async () => {
  db = await testDatabase();
  const s = await seed(db, 'Measured');
  owner = s.member_id;
  viewer = await db.createMember(s.workspace_id, ['viewer'], 'Hamza Nasser');
  supplier = await db.createMember(s.workspace_id, ['supplier_maintainer'], 'Yusuf Rahman');
  const hidden = (await db.owner.query<{ id: string }>(`INSERT INTO nazir.scenarios(workspace_id,meaning_id,stable_key,version,family,language,split,persona,starting_state,allowed_actions,forbidden_actions,expected_state,source_clause,expectation_kind,severity,rubric_version,status) VALUES($1,$2,'hidden_m',1,'test','ar','hidden','{}','{}','{}','{}','{}','fictional','fictional_demo_rule','high','1','approved') RETURNING id`, [s.workspace_id, s.ids.scenario_meanings])).rows[0]!.id;
  await db.owner.query("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status) VALUES($1,$2,$3,'ar','hidden_m','failed')", [s.workspace_id, s.ids.runs, hidden]);
  outsider = (await seed(db, 'Other')).member_id;
  await db.owner.query("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key,status,result_summary) VALUES($1,$2,$3,'en','measured','passed',$4)", [s.workspace_id, s.ids.runs, s.ids.scenarios, JSON.stringify({ records: [{ id: 'case_exists', status: 'pass' }], semantic: { status: 'supported' } })]);
}, 60000);
afterAll(async () => { await db?.close(); });

it('measures saved runs inside the workspace, keeps hidden cases from a supplier, and gives a viewer a note', async () => {
  const a = await measuredResults(db.driver, owner);
  const v = await measuredResults(db.driver, viewer);
  const o = await measuredResults(db.driver, outsider);
  expect(a.conversations).toBe(3);
  const sp = await measuredResults(db.driver, supplier);
  expect(sp.conversations).toBe(2);
  expect(a.metrics.find((m) => m.id === 'action_correctness')).toMatchObject({ numerator: 1, denominator: 1 });
  expect(v).toMatchObject({ restricted: true, metrics: [] });
  expect(o.metrics.find((m) => m.id === 'action_correctness')!.denominator).toBe(0);
});
