import { beforeAll, afterAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { fixture, journey, type Fixture } from '../runner/helpers';
import { enqueueRun } from '../../src/server/runner/enqueue';
import { runNextConversation } from '../../src/server/runner/worker';
import { buildComparison, compareRuns, languageParity, readComparisons, settingsDiffer, type ConversationRow, type RunData } from '../../src/server/compare/compare';
import { readAuditChain, verifyAuditChain } from '../../src/server/audit/verify';
import { semantic } from '../judge/helpers';

const conv = (key: string, status: ConversationRow['status'], extra: Partial<ConversationRow> = {}): ConversationRow => ({
  id: crypto.randomUUID(), idempotency_key: key, status, inconclusive_reason: status === 'inconclusive' ? 'provider_exhausted' : null,
  language: key.includes(':ar:') ? 'ar' : 'en', scenario_hash: 'h_' + key.split(':')[0], stable_key: key.split(':')[0]!, family: extra.family ?? 'complaint', split: 'development', meaning_id: 'm_' + key.split(':')[0]!.replace(/_(en|ar)$/, ''),
  failover: false, model_provider: 'kilo', model_id: 'model', model_calls: [{ attempt: 1, provider: 'kilo', model: 'model', failover: false }],
  result_summary: { records: [{ id: 'case_exists', status: 'pass' }, { id: 'right_queue', status: status === 'failed' ? 'fail' : 'pass' }], semantic: { status: 'supported' } }, ...extra,
});
const run = (id: string, conversations: ConversationRow[], manifest: Record<string, unknown> = { aiChainOrder: [1], rubricVersion: 'n13.1', recordsOnly: false }): RunData => ({ id, status: 'failed', agent_version_id: 'v_' + id, manifest, conversations });

it('pairs only the same scenario, language and repeat and classifies every pair', () => {
  const a = run('a', [conv('k1_en:en:1', 'failed'), conv('k1_ar:ar:1', 'failed'), conv('k2_en:en:1', 'passed'), conv('k3_en:en:1', 'failed'), conv('k4_en:en:1', 'passed'), conv('k5_en:en:1', 'inconclusive'), conv('k6_en:en:1', 'passed'), conv('k1_en:en:2', 'failed')]);
  const b = run('b', [conv('k1_en:en:1', 'passed'), conv('k1_ar:ar:1', 'passed'), conv('k2_en:en:1', 'failed'), conv('k3_en:en:1', 'failed'), conv('k4_en:en:1', 'passed'), conv('k5_en:en:1', 'passed'), conv('k7_en:en:1', 'passed'), conv('k1_en:en:2', 'inconclusive')]);
  const { summary, pairs } = buildComparison(a, b);
  const cls = Object.fromEntries(pairs.map((p) => [p.key, p.class]));
  expect(cls).toMatchObject({ 'k1_en:en:1': 'improved', 'k1_ar:ar:1': 'improved', 'k2_en:en:1': 'regressed', 'k3_en:en:1': 'still_failing', 'k4_en:en:1': 'still_passing', 'k5_en:en:1': 'inconclusive', 'k1_en:en:2': 'inconclusive', 'k6_en:en:1': 'unpaired', 'k7_en:en:1': 'unpaired' });
  expect(summary.totals).toEqual({ paired: 7, improved: 2, regressed: 1, still_failing: 1, still_passing: 1, inconclusive: 2, failover: 0 });
  expect(summary.unpaired).toEqual({ a: 1, b: 1 });
  expect(summary.byLanguage.ar).toMatchObject({ paired: 1, improved: 1 });
  expect(summary.byLanguage.en.paired).toBe(6);
  expect(summary.sentences.en[0]).toBe('Version B improved 2 of 7 paired tests.');
  expect(summary.sentences.en[2]).toContain('2 of 7');
  expect(summary.sentences.ar[0]).toMatch(/[\u0600-\u06ff]/);
  expect(summary.settingsDiffer).toBeNull();
  // An inconclusive side never counts as improved or passed.
  expect(pairs.filter((p) => p.class === 'improved').every((p) => p.b?.status === 'passed' && p.a?.status === 'failed')).toBe(true);
});
it('lists check level regressions inside two failed conversations', () => {
  const a = run('a', [conv('k_en:en:1', 'failed', { result_summary: { records: [{ id: 'case_exists', status: 'pass' }, { id: 'right_queue', status: 'fail' }] } })]);
  const b = run('b', [conv('k_en:en:1', 'failed', { result_summary: { records: [{ id: 'case_exists', status: 'fail' }, { id: 'right_queue', status: 'pass' }] } })]);
  const { pairs, summary } = buildComparison(a, b);
  expect(pairs[0]).toMatchObject({ class: 'still_failing', check_regressions: ['case_exists'], check_improvements: ['right_queue'] });
  expect(summary.regressions).toEqual([{ key: 'k_en:en:1', checks: ['case_exists'], split: 'development' }]);
});
it('tags failover pairs and counts them separately', () => {
  const a = run('a', [conv('k_en:en:1', 'failed'), conv('j_en:en:1', 'failed')]);
  const b = run('b', [conv('k_en:en:1', 'passed', { model_calls: [{ attempt: 1, provider: 'kilo', failover: false }, { attempt: 1, provider: 'openrouter', failover: true }] }), conv('j_en:en:1', 'passed', { failover: true })]);
  const { pairs, summary } = buildComparison(a, b);
  expect(pairs.every((p) => p.failover)).toBe(true);
  expect(pairs[1]!.b!.providers).toEqual(['kilo', 'openrouter']);
  expect(summary.totals.failover).toBe(2);
  expect(summary.failoverPairs).toEqual(['j_en:en:1', 'k_en:en:1']);
});
it('flags changed settings and never pairs a changed scenario', () => {
  const a = run('a', [conv('k_en:en:1', 'failed')]);
  const b = run('b', [conv('k_en:en:1', 'passed', { scenario_hash: 'other' })], { aiChainOrder: [2], rubricVersion: 'n13.1', recordsOnly: true });
  const { pairs, summary } = buildComparison(a, b);
  expect(summary.settingsDiffer).toEqual(['aiChainOrder', 'recordsOnly']);
  expect(summary.scenarioHashDiffers).toEqual(['k_en:en:1']);
  expect(pairs.map((p) => p.class)).toEqual(['unpaired', 'unpaired']);
  expect(summary.totals.paired).toBe(0);
  expect(settingsDiffer({ a: 1 }, { a: 2 })).toEqual([]);
});
it('refuses unfinished and stopped checks before measuring improvement', () => {
  const complete = run('a', [conv('k_en:en:1', 'failed')]);
  expect(() => buildComparison(complete, { ...run('b', [conv('k_en:en:1', 'passed')]), status: 'cancelled' })).toThrow('finished');
  expect(() => buildComparison(complete, run('b', [conv('k_en:en:1', 'passed'), conv('j_en:en:1', 'cancelled')]))).toThrow('finished');
  expect(() => buildComparison({ ...run('a', []), status: 'running' }, run('b', []))).toThrow('finished');
});
it('reports language parity with denominators and the review line', () => {
  const r = run('r', [conv('k_en:en:1', 'passed'), conv('k_ar:ar:1', 'failed'), conv('j_en:en:1', 'passed'), conv('j_ar:ar:1', 'passed'), conv('i_en:en:1', 'passed'), conv('i_ar:ar:1', 'inconclusive'), conv('solo_en:en:1', 'passed')]);
  const p = languageParity(r);
  expect(p).toMatchObject({ paired: 3, same: 1, differ: 1, inconclusive: 1 });
  expect(p.sentences.en[3]).toContain('review signal');
  expect(p.sentences.ar[3]).toMatch(/[\u0600-\u06ff]/);
});

let db: TestDatabase, f: Fixture;
beforeAll(async () => { db = await testDatabase(); f = await fixture(db, 'compare'); });
afterAll(async () => { await db?.close(); });
async function finishedRun(version: string) {
  const r = await enqueueRun(db.driver, { workspaceId: f.workspaceId, planId: f.planId, agentVersionId: f.versions.find((v) => v.registry_id === version)!.id, scenarioIds: f.scenarios.map((s) => s.id), repeats: 1, idempotencyKey: crypto.randomUUID(), recordsOnly: false });
  while (await runNextConversation({ driver: db.driver, inspectionDriver: db.driver, workerId: 'compare_worker', chatModelFactory: () => journey(), judgeFactory: () => async ({ input }) => semantic('supported', input.reply.slice(0, 60), 'none') }));
  return r.id;
}
it('stores a reproducible comparison of a planted and a baseline run with paired EN and AR results', async () => {
  const oldRun = await finishedRun('planted_wrong_queue'), newRun = await finishedRun('baseline');
  const owner = await db.createMember(f.workspaceId, ['service_owner'], 'Faisal Rahman');
  const first = await compareRuns(db.driver, owner, { runA: oldRun, runB: newRun });
  expect(first.summary.totals).toMatchObject({ paired: 2, improved: 2, regressed: 0, inconclusive: 0 });
  expect(first.summary.byLanguage.en.improved).toBe(1);
  expect(first.summary.byLanguage.ar.improved).toBe(1);
  expect(first.pairs.map((p) => [p.language, p.a?.status, p.b?.status])).toEqual(expect.arrayContaining([['en', 'failed', 'passed'], ['ar', 'failed', 'passed']]));
  expect(first.pairs.find((p) => p.language === 'en')!.check_improvements).toEqual(expect.arrayContaining(['right_queue', 'linked_escalation']));
  expect(first.parity.b).toMatchObject({ paired: 1, same: 1 });
  const second = await compareRuns(db.driver, owner, { runA: oldRun, runB: newRun });
  expect(second.summary_hash).toBe(first.summary_hash);
  expect(second.id).not.toBe(first.id);
  await expect(db.owner.query("UPDATE nazir.comparisons SET summary='{}' WHERE id=$1", [first.id])).rejects.toThrow('Comparisons cannot change');
  await expect(db.owner.query('DELETE FROM nazir.comparisons WHERE id=$1', [first.id])).rejects.toThrow('Comparisons cannot change');
  const chain = await readAuditChain(db.owner, f.workspaceId);
  expect(chain.some((e) => e.action === 'comparison.created')).toBe(true);
  expect(verifyAuditChain(chain).ok).toBe(true);
  // A pair judge result is stored per pair; uncertain is never counted as better.
  const judged = await compareRuns(db.driver, owner, { runA: oldRun, runB: newRun, pairJudge: async ({ pair }) => ({ better: pair.language === 'en' ? 'B' : 'uncertain' }) });
  expect((judged.summary as Record<string, unknown>).judgedPairs).toMatchObject({ judged: 2, betterB: 1, uncertain: 1 });
});
it('limits who can create and what each role reads', async () => {
  const oldRun = await finishedRun('planted_wrong_queue'), newRun = await finishedRun('baseline');
  const reviewer = await db.createMember(f.workspaceId, ['quality_reviewer'], 'Tariq Aziz');
  const supplier = await db.createMember(f.workspaceId, ['supplier_maintainer'], 'Nabil Saleh');
  const viewer = await db.createMember(f.workspaceId, ['viewer'], 'Rashid Karim');
  const made = await compareRuns(db.driver, reviewer, { runA: oldRun, runB: newRun });
  await expect(compareRuns(db.driver, supplier, { runA: oldRun, runB: newRun })).rejects.toThrow();
  await expect(compareRuns(db.driver, viewer, { runA: oldRun, runB: newRun })).rejects.toThrow();
  await expect(db.member(supplier, (sql) => sql.query("INSERT INTO nazir.comparisons(workspace_id,run_a_id,run_b_id,comparer_version,summary,pairs) VALUES(nazir.current_workspace_id(),$1,$2,'n17','{}','[]')", [oldRun, newRun]))).rejects.toThrow();
  expect(await db.member(supplier, async (sql) => (await sql.query('SELECT * FROM nazir.comparisons')).rows)).toEqual([]);
  expect(await db.member(viewer, async (sql) => (await sql.query('SELECT * FROM nazir.comparisons')).rows)).toEqual([]);
  const supplierView = (await readComparisons(db.driver, supplier)).find((c) => c.id === made.id)!;
  expect(supplierView.pairs).toHaveLength(2);
  expect(supplierView.hidden_pairs).toBe(0);
  const viewerView = (await readComparisons(db.driver, viewer)).find((c) => c.id === made.id)!;
  expect(viewerView.pairs).toBeUndefined();
  expect((viewerView.summary as { totals: { paired: number } }).totals.paired).toBe(2);
  expect((viewerView.summary as Record<string, unknown>).byFamily).toBeUndefined();
  const other = await fixture(db, 'compare_other');
  const outsider = await db.createMember(other.workspaceId, ['service_owner'], 'Zaid Haddad');
  expect((await readComparisons(db.driver, outsider)).some((c) => c.id === made.id)).toBe(false);
  await expect(compareRuns(db.driver, outsider, { runA: oldRun, runB: newRun })).rejects.toThrow();
});
it('hides hidden pairs from a supplier and keeps them as a count', async () => {
  const oldRun = await finishedRun('planted_wrong_queue'), newRun = await finishedRun('baseline');
  const owner = await db.createMember(f.workspaceId, ['service_owner'], 'Hamza Qasim');
  const supplier = await db.createMember(f.workspaceId, ['supplier_maintainer'], 'Adel Farouk');
  const made = await compareRuns(db.driver, owner, { runA: oldRun, runB: newRun });
  // Store a second comparison whose pairs are marked hidden, through the owner path, to check the projection.
  const hiddenPairs = made.pairs.map((p) => ({ ...p, split: 'hidden' }));
  const summary = { ...made.summary, byFamily: made.summary.byFamily.map((x) => ({ ...x, split: 'hidden' })) };
  const id = await db.member(owner, async (sql) => (await sql.query<{ id: string }>("INSERT INTO nazir.comparisons(workspace_id,run_a_id,run_b_id,comparer_version,summary,pairs) VALUES(nazir.current_workspace_id(),$1,$2,'n17',$3,$4) RETURNING id", [oldRun, newRun, JSON.stringify(summary), JSON.stringify(hiddenPairs)])).rows[0]!.id);
  const view = (await readComparisons(db.driver, supplier)).find((c) => c.id === id)!;
  expect(view.pairs).toEqual([]);
  expect(view.hidden_pairs).toBe(2);
  expect((view.summary as { byFamily: unknown[] }).byFamily).toEqual([]);
});
