import { beforeAll, afterAll, expect, it } from 'vitest';
import { testDatabase, seed, type TestDatabase } from '../helpers/pglite';
import { journey } from '../runner/helpers';
import { runNextConversation } from '../../src/server/runner/worker';
import { createLibraryFixture } from '../../src/server/runner/library-fixture';
import { semantic } from '../judge/helpers';
import { checkEffect, LessonRefused, lessonReason } from '../../src/server/memory/effects';
import { judgeNotes, lessonsForFinding, type FrozenLesson } from '../../src/server/memory/frozen';
import { planOrder, proposeNextPlan, approvePlan, startNextPlan, type PlanScenario } from '../../src/server/memory/planner';
import { rememberLesson, suggestLessonFromCorrection, answerLessonSuggestion, listLessons, editLesson, deleteLesson, undoLesson, lessonHistory, approveBigLesson } from '../../src/server/memory/lessons';
import { talkToCorrect, fallbackIntent, lessonTextFor, type TalkChain } from '../../src/server/memory/talk';
import { buildJudgeInput } from '../../src/server/judge/rubric';
import { overrideFinding } from '../../src/server/services';

const code = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return (e as LessonRefused).code; } };
it('allows only listed lesson effects and never a different expected queue', () => {
  expect(checkEffect({ kind: 'test_first', family: 'wrong_routing_queue' })).toEqual({ kind: 'test_first', family: 'wrong_routing_queue' });
  expect(code(() => checkEffect({ kind: 'skip_check', check: 'right_queue' }))).toBe('effect_not_allowed');
  expect(code(() => checkEffect({ kind: 'test_harder', family: 'wrong_routing_queue', repeats: 9 }))).toBe('effect_not_allowed');
  expect(code(() => checkEffect({ kind: 'test_first', family: 'payments' }))).toBe('effect_not_allowed');
  expect(code(() => checkEffect({ kind: 'check_queue', category: 'complaint', queue: 'general_information' }))).toBe('changes_expected_result');
  expect(code(() => checkEffect({ kind: 'note', extra: true }))).toBe('effect_not_allowed');
  const r = lessonReason('Check the complaint queue first.', null, { kind: 'check_queue', category: 'complaint', queue: 'complaint_review' });
  expect(r.en).toContain('Last time the reviewer said'); expect(r.ar).toMatch(/[\u0600-\u06ff]/);
});
it('orders the plan by lessons, then failure history, without adding or removing a scenario', () => {
  const s = (id: string, family: string, category: string | null = null, checks: string[] = []): PlanScenario => ({ id, meaning_id: id, meaning_key: id, meaning_kind: 'normal', family, split: 'development', stable_key: id, language: 'en', library: true, checks, category });
  const all = [s('a', 'broad_case_export'), s('b', 'wrong_routing_queue', 'complaint', ['right_queue']), s('c', 'complaint_vs_suggestion', 'suggestion', ['right_queue'])];
  const plain = planOrder(all, { complaint_vs_suggestion: 3 }, []);
  expect(plain.order).toEqual(['complaint_vs_suggestion', 'broad_case_export', 'wrong_routing_queue']);
  const lesson = { id: 'l1', version: 1, text: 'Check the complaint queue first.', text_ar: null, scope: 'small', approved_by: null, effect: { kind: 'check_queue', category: 'complaint', queue: 'complaint_review' } as const };
  const harder = { ...lesson, id: 'l2', text: 'Test exports more.', effect: { kind: 'test_harder', family: 'broad_case_export', repeats: 3 } as const };
  const p = planOrder(all, { complaint_vs_suggestion: 3 }, [lesson, harder]);
  expect(p.order).toEqual(['wrong_routing_queue', 'broad_case_export', 'complaint_vs_suggestion']);
  expect(new Set(p.scenarioIds)).toEqual(new Set(plain.scenarioIds));
  expect(p.repeatsFor).toEqual({ a: 3 });
  expect(p.lessonsUsed.map((l) => l.lesson_id)).toEqual(['l1', 'l2']);
  const unrelated = planOrder(all, {}, [{ ...lesson, id: 'l3', effect: { kind: 'test_first', family: 'mixed_names_and_numerals' } }]);
  expect(unrelated.lessonsUsed).toEqual([]);
  const frozen = p.lessonsUsed as FrozenLesson[];
  expect(lessonsForFinding(frozen, 'wrong_routing_queue', 'right_queue').map((l) => l.lesson_id)).toEqual(['l1']);
  expect(lessonsForFinding(frozen, 'broad_case_export', 'ownership').map((l) => l.lesson_id)).toEqual(['l2']);
  expect(lessonsForFinding(frozen, 'english_msa_equivalent', 'ownership')).toEqual([]);
  expect(judgeNotes([{ ...frozen[0]!, effect: { kind: 'judge_note', family: 'wrong_routing_queue', note: 'A queue name alone is not proof.' } }], 'wrong_routing_queue')).toEqual(['A queue name alone is not proof.']);
});
it('reads simple commands when no model answers', () => {
  const both = { any: 'x', live: 'y' };
  expect(fallbackIntent('Forget that', both)).toMatchObject({ action: 'delete', lesson_id: 'y' });
  expect(fallbackIntent('انس ذلك', both).action).toBe('delete');
  expect(fallbackIntent('تراجع', both)).toMatchObject({ action: 'undo', lesson_id: 'x' });
  expect(fallbackIntent('undo', { any: null, live: null }).action).toBe('none');
  expect(fallbackIntent('hello', both).action).toBe('none');
});

let db: TestDatabase, lib: Awaited<ReturnType<typeof createLibraryFixture>>, rulePack: string;
beforeAll(async () => {
  db = await testDatabase(); lib = await db.driver.transaction(createLibraryFixture);
  rulePack = (await db.owner.query<{ rule_pack_version_id: string }>('SELECT rule_pack_version_id FROM nazir.plans WHERE id=$1', [lib.planId])).rows[0]!.rule_pack_version_id;
}, 60000);
afterAll(async () => { await db?.close(); });
const version = (id: string) => lib.versions.find((v) => v.registry_id === id)!.id;
const scripted = (content: string): TalkChain => ({ chat: async (r) => { if (r.validate?.({ content })) throw new Error('invalid'); return { content, meta: { provider: 'scripted', model: 'scripted', family: 'unknown', attempts: [], failover: false, failoverReason: null } }; } });
const down: TalkChain = { chat: async () => { throw new Error('AI chain exhausted'); } };
async function drain() {
  while (await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'memory_worker', chatModelFactory: () => journey(), judgeFactory: () => async ({ input }) => semantic('supported', input.reply.slice(0, 60), 'none') }));
}

it('keeps the lesson list with edit, delete and undo as history', async () => {
  const { reviewer, supplier } = lib.members;
  const l = await rememberLesson(db.driver, reviewer, { text: 'Test duplicates first.', language: 'en', effect: { kind: 'test_first', family: 'repeated_request_duplicates' } });
  expect(l).toMatchObject({ status: 'active', scope: 'small', version: 1 });
  const listed = await listLessons(db.driver, supplier);
  expect(listed.find((x) => x.id === l.id)).toMatchObject({ confirmedBy: 'Khalid Hamdan', label: { en: 'Active' } });
  await expect(editLesson(db.driver, supplier, { id: l.id, text: 'Supplier edit.' })).rejects.toThrow();
  const viewer = await db.createMember(lib.workspaceId, ['viewer'], 'Hamza Viewer');
  await expect(listLessons(db.driver, viewer)).rejects.toThrow();
  const edited = await editLesson(db.driver, reviewer, { id: l.id, text: 'Test duplicate requests first.' });
  expect(edited).toMatchObject({ version: 2, text: 'Test duplicate requests first.' });
  await deleteLesson(db.driver, reviewer, l.id);
  expect((await listLessons(db.driver, reviewer)).some((x) => x.id === l.id)).toBe(false);
  const back = await undoLesson(db.driver, reviewer, l.id);
  expect(back).toMatchObject({ status: 'active', text: 'Test duplicate requests first.', version: 4 });
  const again = await undoLesson(db.driver, reviewer, l.id);
  expect(again.status).toBe('deleted');
  const history = await lessonHistory(db.driver, reviewer, l.id);
  expect(history.map((h) => (h as { status_after: string }).status_after)).toEqual(['active', 'active', 'deleted', 'active', 'deleted']);
  // Raw SQL cannot store an effect outside the allowlist.
  await expect(db.member(reviewer, (sql) => sql.query("INSERT INTO nazir.lessons(workspace_id,text,scope,created_by_type,effect) VALUES(nazir.current_workspace_id(),'x','small','member','{\"kind\":\"skip_check\"}')"))).rejects.toThrow(/not allowed/);
  // A worker can only suggest.
  await expect(db.worker(lib.workspaceId, (sql) => sql.query("INSERT INTO nazir.lessons(workspace_id,text,scope,created_by_type,status) VALUES($1,'x','small','nazir','active')", [lib.workspaceId]))).rejects.toThrow(/row-level security/);
});
it('asks "Should I remember this?" after a correction, and big lessons wait for the owner', async () => {
  const { reviewer, author } = lib.members;
  // Make a finding to correct.
  const plan = await proposeNextPlan(db.driver, lib.workspaceId, { agent_version_id: version('planted_wrong_queue'), rule_pack_version_id: rulePack, families: ['wrong_routing_queue'], languages: ['en'] });
  await approvePlan(db.driver, reviewer, { id: plan.id, reason: 'Plan reviewed against the families.', evidence_opened: true });
  const run = await startNextPlan(db.driver, reviewer, plan.id);
  await drain();
  const finding = (await db.owner.query<{ id: string; check_id: string }>("SELECT id,check_id FROM nazir.findings WHERE run_id=$1 AND check_id='right_queue' LIMIT 1", [run.id])).rows[0]!;
  expect(finding).toBeTruthy();
  await overrideFinding(db.driver, reviewer, { id: finding.id, reason: 'This queue was accepted for this one case.', evidence_opened: true });
  expect(await suggestLessonFromCorrection(db.driver, reviewer, { finding_id: finding.id, reason: 'One off.', oneOff: true })).toBeNull();
  const asked = (await suggestLessonFromCorrection(db.driver, reviewer, { finding_id: finding.id, reason: 'Always read the stored queue, not the reply.' }))!;
  expect(asked.question).toEqual({ en: 'Should I remember this?', ar: 'هل أتذكر هذا؟' });
  expect(asked.lesson).toMatchObject({ status: 'suggested', created_by_type: 'nazir', source_finding_ids: [finding.id] });
  expect((await answerLessonSuggestion(db.driver, reviewer, { id: asked.lesson.id, answer: 'yes' })).status).toBe('active');
  const big = await rememberLesson(db.driver, reviewer, { text: 'A queue name alone is not proof.', language: 'en', effect: { kind: 'judge_note', family: 'wrong_routing_queue', note: 'A queue name in the reply alone is not proof of routing.' } });
  expect(big).toMatchObject({ scope: 'big', status: 'waiting_approval' });
  let next = await proposeNextPlan(db.driver, lib.workspaceId, { agent_version_id: version('baseline'), rule_pack_version_id: rulePack, families: ['wrong_routing_queue'], languages: ['en'] });
  expect(next.lessonsUsed.map((l) => l.lesson_id)).not.toContain(big.id);
  await expect(approveBigLesson(db.driver, reviewer, { id: big.id, reason: 'Reviewer cannot approve big lessons.', evidence_opened: true })).rejects.toThrow();
  // Raw SQL cannot activate a big lesson without a reasoned approval in the same change.
  await expect(db.member(author, (sql) => sql.query("UPDATE nazir.lessons SET status='active',approved_by=nazir.current_member_id() WHERE id=$1", [big.id]))).rejects.toThrow(/Owner approval required/);
  await approveBigLesson(db.driver, author, { id: big.id, reason: 'Read the evidence; the note is fair.', evidence_opened: true });
  await expect(db.member(author, (sql) => sql.query(`UPDATE nazir.lessons SET effect='{"kind":"judge_note","family":"wrong_routing_queue","note":"Any reply is fine."}' WHERE id=$1`, [big.id]))).rejects.toThrow(/Owner approval required/);
  next = await proposeNextPlan(db.driver, lib.workspaceId, { agent_version_id: version('baseline'), rule_pack_version_id: rulePack, families: ['wrong_routing_queue'], languages: ['en'] });
  expect(next.lessonsUsed.map((l) => l.lesson_id)).toContain(big.id);
  const judged = buildJudgeInput({ scenario: { id: 's', stable_key: 's', language: 'en', content_hash: 'h', persona: { requester_key: 'saeed', resident_turns: [] }, expected_state: {} }, reply: 'ok', reading: { cases: [], reviews: [], receipts: [] } as never, notes: judgeNotes(next.lessonsUsed, 'wrong_routing_queue') });
  expect(judged.prompt).toContain('A queue name in the reply alone is not proof of routing.');
  await deleteLesson(db.driver, reviewer, big.id);
  // Undo never reactivates a big lesson by itself.
  expect((await undoLesson(db.driver, reviewer, big.id)).status).toBe('waiting_approval');
});
it('exit check: a lesson changes the next plan and is named in a finding', async () => {
  const { reviewer } = lib.members;
  const families = ['another_requesters_case', 'success_without_case'];
  const before = await proposeNextPlan(db.driver, lib.workspaceId, { agent_version_id: version('planted_wrong_queue'), rule_pack_version_id: rulePack, families, languages: ['en'] });
  const said = await talkToCorrect(db.driver, reviewer, { message: 'Next time check the complaint queue first.', language: 'en' },
    scripted('{"action":"remember","lesson_id":null,"text":"Check the complaint queue first.","effect":{"kind":"check_queue","category":"complaint","queue":"complaint_review"}}'));
  expect(said).toMatchObject({ action: 'remember', source: 'model', reply: { en: 'I will remember this.' } });
  const after = await proposeNextPlan(db.driver, lib.workspaceId, { agent_version_id: version('planted_wrong_queue'), rule_pack_version_id: rulePack, families, languages: ['en'] });
  expect(before.order[0]).toBe('another_requesters_case');
  expect(after.order[0]).toBe('success_without_case');
  expect(after.scenarioIds).not.toEqual(before.scenarioIds);
  const used = after.lessonsUsed.find((l) => l.lesson_id === said.lesson!.id)!;
  expect(used.reason.en).toContain('Check the complaint queue first.');
  const stored = (await db.owner.query<{ lessons_used: { lesson_id: string }[] }>('SELECT lessons_used FROM nazir.plans WHERE id=$1', [after.id])).rows[0]!;
  expect(stored.lessons_used.map((l) => l.lesson_id)).toContain(said.lesson!.id);
  await approvePlan(db.driver, reviewer, { id: after.id, reason: 'The order follows the lesson.', evidence_opened: true });
  const run = await startNextPlan(db.driver, reviewer, after.id);
  const manifest = (await db.owner.query<{ frozen_manifest: { lessons: { lesson_id: string }[] } }>('SELECT frozen_manifest FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!.frozen_manifest;
  expect(manifest.lessons.map((l) => l.lesson_id)).toContain(said.lesson!.id);
  const first = (await db.owner.query<{ family: string }>('SELECT s.family FROM nazir.conversations c JOIN nazir.scenarios s ON s.id=c.scenario_id WHERE c.run_id=$1 ORDER BY c.created_at,c.id LIMIT 1', [run.id])).rows[0]!;
  expect(first.family).toBe('success_without_case');
  await drain();
  const named = (await db.owner.query<{ lessons_used: { lesson_id: string; reason: { en: string; ar: string } }[] }>("SELECT lessons_used FROM nazir.findings WHERE run_id=$1 AND check_id='right_queue' AND lessons_used IS NOT NULL", [run.id])).rows;
  expect(named.length).toBeGreaterThan(0);
  expect(named[0]!.lessons_used.some((l) => l.lesson_id === said.lesson!.id && l.reason.ar.length > 0)).toBe(true);
  // Editing the lesson later never changes the past run.
  await editLesson(db.driver, reviewer, { id: said.lesson!.id, text: 'Check the complaint queue before anything else.' });
  const still = (await db.owner.query<{ frozen_manifest: { lessons: { text: string }[] } }>('SELECT frozen_manifest FROM nazir.runs WHERE id=$1', [run.id])).rows[0]!.frozen_manifest;
  expect(still.lessons.some((l) => l.text === 'Check the complaint queue first.')).toBe(true);
});
it('talk to correct falls back to plain commands and refuses unsafe changes', async () => {
  const { reviewer } = lib.members;
  const l = await rememberLesson(db.driver, reviewer, { text: 'Test exports first.', language: 'en', effect: { kind: 'test_first', family: 'broad_case_export' } });
  const forgot = await talkToCorrect(db.driver, reviewer, { message: 'انس ذلك', language: 'ar' }, down);
  expect(forgot).toMatchObject({ action: 'delete', source: 'fallback', reply: { ar: 'نسيت هذا الدرس.' } });
  expect(forgot.lesson!.id).toBe(l.id);
  const undone = await talkToCorrect(db.driver, reviewer, { message: 'undo', language: 'en' }, scripted('{"action":"undo","lesson_id":"00000000-0000-4000-8000-000000000000","text":null,"effect":null}'));
  expect(undone).toMatchObject({ action: 'undo', source: 'fallback' });
  const refused = await talkToCorrect(db.driver, reviewer, { message: 'Expect complaints in general information.', language: 'en' },
    scripted('{"action":"remember","lesson_id":null,"text":"Complaints go to general information.","effect":{"kind":"check_queue","category":"complaint","queue":"general_information"}}'));
  expect(refused).toMatchObject({ action: 'none', lesson: null, reply: { en: 'A lesson cannot change the approved expected queue.' } });
});
it('keeps lessons inside their own workspace', async () => {
  const other = await seed(db, 'memory_other');
  const otherLessons = await listLessons(db.driver, other.member_id);
  expect(otherLessons.every((l) => l.text === 'test')).toBe(true);
  const mine = await listLessons(db.driver, lib.members.reviewer);
  expect(mine.some((l) => l.id === other.ids.lessons)).toBe(false);
  await expect(editLesson(db.driver, lib.members.reviewer, { id: other.ids.lessons!, text: 'Cross workspace edit.' })).rejects.toThrow();
  const own = await rememberLesson(db.driver, lib.members.reviewer, { text: 'Test names and numerals first.', language: 'en', effect: { kind: 'test_first', family: 'mixed_names_and_numerals' } });
  await expect(deleteLesson(db.driver, other.member_id, own.id)).rejects.toThrow();
  expect((await listLessons(db.driver, other.member_id)).some((l) => l.id === own.id)).toBe(false);
  const plan = await proposeNextPlan(db.driver, other.workspace_id, { agent_version_id: other.ids.agent_versions!, rule_pack_version_id: other.ids.rule_pack_versions! }).catch((e: Error) => e);
  // The other workspace has no approved scenarios of its own and never sees this workspace's lessons.
  expect(plan instanceof Error || plan.lessonsUsed.length === 0).toBe(true);
});

// Live fix (Oct 20): a free model on Kilo wrote its reasoning, with braces, before the JSON answer.
it('reads the last valid intent after reasoning text with braces', async () => {
  const { parseIntent } = await import('../../src/server/memory/talk');
  const answer = '{"action":"remember","lesson_id":null,"text":"Check the complaint queue first.","effect":{"kind":"check_queue","category":"complaint","queue":"complaint_review"}}';
  const reasoning = 'The format is {"action":...,"effect":object or null}. The effect could be {"kind":"check_queue"} with queue complaint_review.\n';
  expect(parseIntent(reasoning + answer, new Set()).effect).toEqual({ kind: 'check_queue', category: 'complaint', queue: 'complaint_review' });
  expect(() => parseIntent(reasoning, new Set())).toThrow('invalid_response');
  expect(() => parseIntent('no json here', new Set())).toThrow('invalid_response');
});
it('names the allowed queues and families and gives the model room to answer', async () => {
  let seen: { content: string; maxTokens?: number } | null = null;
  const capture: TalkChain = { chat: async (r) => { seen = { content: String(r.messages[0]!.content), maxTokens: r.maxTokens }; throw new Error('stop'); } };
  await talkToCorrect(db.driver, lib.members.reviewer, { message: 'Next time, check the complaint queue first.', language: 'en' }, capture);
  expect(seen!.content).toContain('complaint with complaint_review');
  expect(seen!.content).toContain('success_without_case');
  expect(seen!.content).toContain('For remember, lesson_id is null');
  expect(seen!.maxTokens).toBeGreaterThanOrEqual(1500);
});

it('talk to correct keeps an Arabic lesson in Arabic', () => {
  const said = 'في المرة القادمة افحص طابور الشكاوى أولا.';
  expect(lessonTextFor('Check the complaint queue first.', said, 'ar')).toBe(said);
  expect(lessonTextFor('افحص طابور الشكاوى أولا.', said, 'ar')).toBe('افحص طابور الشكاوى أولا.');
  expect(lessonTextFor('Check the complaint queue first.', 'Next time check it first.', 'en')).toBe('Check the complaint queue first.');
  expect(lessonTextFor(null, said, 'ar')).toBeNull();
  expect(lessonTextFor('x', 'ب'.repeat(900), 'ar')).toHaveLength(500);
});
