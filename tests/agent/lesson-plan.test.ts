import { afterAll, beforeAll, expect, it } from 'vitest';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
import { agentChat } from '../../src/server/agent/chat';
import { judgeNotes, type FrozenLesson } from '../../src/server/memory/frozen';
import { approveBigLesson, rememberLesson } from '../../src/server/memory/lessons';

let db: TestDatabase;
let reviewer: string;
let owner: string;

beforeAll(async () => {
  db = await testDatabase();
  const seeded = await seed(db, 'Omar');
  owner = seeded.member_id;
  reviewer = await db.createMember(seeded.workspace_id, ['quality_reviewer'], 'Khalid Hamdan');
  await db.owner.query("UPDATE nazir.scenarios SET status='approved' WHERE workspace_id=$1", [seeded.workspace_id]);
  await db.owner.query("UPDATE nazir.rule_pack_versions SET status='approved' WHERE id=$1", [seeded.ids.rule_pack_versions]);
  await db.owner.query("UPDATE nazir.agent_versions SET kind='baseline', config='{\"registry_id\":\"baseline\"}'::jsonb WHERE id=$1", [seeded.ids.agent_versions]);
  await db.owner.query('DELETE FROM nazir.proposals WHERE workspace_id=$1', [seeded.workspace_id]);
  await db.owner.query('DELETE FROM nazir.findings WHERE workspace_id=$1', [seeded.workspace_id]);
  const add = (key: string, family: string) => db.owner.query(`INSERT INTO nazir.scenarios(workspace_id,meaning_id,stable_key,version,family,language,split,persona,starting_state,allowed_actions,forbidden_actions,expected_state,source_clause,expectation_kind,severity,rubric_version,status)
    VALUES($1,$2,$3,1,$4,'en','development','{}','{}','{}','{}','{}','fictional','fictional_demo_rule','high','1','approved')`, [seeded.workspace_id, seeded.ids.scenario_meanings, key, family]);
  await add('success_case', 'success_without_case');
  await add('routing_case', 'wrong_routing_queue');
}, 60000);
afterAll(async () => { await db?.close(); });

it('stores a lesson where the next plan, the runner and the judge can read it', async () => {
  const noted = await rememberLesson(db.driver, reviewer, {
    text: 'A queue name alone is not proof.', language: 'en',
    effect: { kind: 'judge_note', family: 'wrong_routing_queue', note: 'A queue name alone is not proof.' },
  });
  expect(noted.status).toBe('waiting_approval');
  await approveBigLesson(db.driver, owner, { id: noted.id, reason: 'The reviewer note is ready to use.', evidence_opened: true });
  const first = await agentChat(db.driver, reviewer, { message: 'propose a plan' }, null);
  expect(first.done).toBe(true);
  expect((first.data as { order: string[] }).order[0]).toBe('success_without_case');
  const correction = 'Please always test wrong_routing_queue first.';
  expect(correction.startsWith('always')).toBe(false);
  const saved = await agentChat(db.driver, reviewer, { message: correction }, null);
  expect(saved.tool).toBe('none');
  const second = await agentChat(db.driver, reviewer, { message: 'propose a plan' }, null);
  expect(second.done).toBe(true);
  const plan = second.data as { id: string; order: string[]; lessonsUsed: { lesson_id: string; effect: { kind: string } }[] };
  expect(plan.order[0]).toBe('wrong_routing_queue');
  expect(plan.lessonsUsed.map((lesson) => lesson.lesson_id)).toEqual(expect.arrayContaining([noted.id]));
  expect(plan.lessonsUsed.some((lesson) => lesson.effect.kind === 'test_first')).toBe(true);
  const started = await agentChat(db.driver, owner, { message: `I approve plan ${plan.id} and start the run because the lesson should lead this plan. I opened the evidence.` }, null);
  expect(started.done).toBe(true);
  const runId = (started.data as { run_id: string }).run_id;
  const manifest = (await db.owner.query<{ frozen_manifest: { lessons?: FrozenLesson[] } }>('SELECT frozen_manifest FROM nazir.runs WHERE id=$1', [runId])).rows[0]!.frozen_manifest;
  expect(manifest.lessons?.length).toBeGreaterThan(0);
  expect(judgeNotes(manifest.lessons, 'wrong_routing_queue')).toEqual(['A queue name alone is not proof.']);
});
