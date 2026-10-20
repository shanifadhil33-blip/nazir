import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { createLibraryFixture } from '../../src/server/runner/library-fixture';
import { runNextConversation } from '../../src/server/runner/worker';
import { semantic } from '../judge/helpers';
import type { ChatModel } from '../../src/sandbox/agent';
import { cleanComplaint, liveTestReady, readLiveSides, startLiveTest, stepLiveTest, type StepDeps } from '../../src/server/livetest/live-test';

let db: TestDatabase; let f: Awaited<ReturnType<typeof createLibraryFixture>>;
const ready = { INSPECT_DATABASE_URL: 'postgres://synthetic', ZAI_API_KEY: 'synthetic' };
const call = (name: string, args: unknown) => ({ content: null, tool_calls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(args) }] });
// A synthetic agent: the clean side files the complaint for review; it reads the version's queue from the tool reply.
const agent: ChatModel = async ({ messages }) => {
  const results = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!));
  if (!results.length) return call('create_case', { category: 'complaint', summary: 'Synthetic delay', requester_name: 'Saeed Al Hashimi', prior_request_ref: 'SR-1042' });
  const ref = results[0].data?.reference;
  if (results.length === 1) return call('request_human_review', { reference: ref, reason: 'Synthetic review' });
  return { content: `Case ${ref} is recorded and sent for human review.` };
};
const deps: StepDeps = { inspectionDriver: () => db.driver, run: ({ driver, inspectionDriver, runId }) => runNextConversation({ driver, inspectionDriver, runId, workerId: 'live_test', chatModelFactory: () => agent, judgeFactory: () => async ({ input }) => semantic('supported', input.reply) }) };
beforeAll(async () => { db = await testDatabase(); f = await db.driver.transaction(createLibraryFixture); }, 120000);
afterAll(async () => { await db?.close(); });

it('is not ready without the inspection channel or a usable provider, and queues nothing then', async () => {
  expect(liveTestReady({})).toBe(false);
  expect(liveTestReady({ INSPECT_DATABASE_URL: 'x' })).toBe(liveTestReady({ INSPECT_DATABASE_URL: 'x' }));
  expect(liveTestReady(ready)).toBe(true);
  const before = (await db.owner.query('SELECT count(*)::int n FROM nazir.runs')).rows[0];
  await expect(startLiveTest(db.driver, f.members.author, { language: 'en', complaint: 'My permit renewal is late and nobody answers.' }, {})).rejects.toMatchObject({ code: 'live_test_unavailable', status: 503 });
  expect((await db.owner.query('SELECT count(*)::int n FROM nazir.runs')).rows[0]).toEqual(before);
});

it('refuses bad input before any work', async () => {
  expect(cleanComplaint('short')).toBeNull();
  expect(cleanComplaint('x'.repeat(401))).toBeNull();
  expect(cleanComplaint('  line\u0000one  ')).toBe('line one');
  await expect(startLiveTest(db.driver, f.members.author, { language: 'fr', complaint: 'A long enough complaint' }, ready)).rejects.toMatchObject({ code: 'validation' });
});

it('runs the judge complaint on the clean and planted versions side by side, scoped to its own runs', async () => {
  const stray = (await db.owner.query<{ n: number }>("SELECT count(*)::int n FROM nazir.conversations WHERE status='queued'")).rows[0]!.n;
  const started = await startLiveTest(db.driver, f.members.reviewer, { language: 'en', complaint: 'My permit renewal SR-1042 is late. This is a complaint.', planted: true }, ready);
  expect(started.runs.map((r) => r.role)).toEqual(['clean', 'planted']);
  const scenario = (await db.owner.query<{ persona: unknown; resident_turns: string[]; status: string; library_hash: string | null }>("SELECT persona,resident_turns,status,library_hash FROM nazir.scenarios WHERE stable_key LIKE 'live_judge_en_%'")).rows[0]!;
  expect(scenario).toMatchObject({ status: 'retired', library_hash: null, persona: { typed_by: 'judge' } });
  expect(scenario.resident_turns[0]).toBe('My permit renewal SR-1042 is late. This is a complaint.');
  const sides = [];
  for (const r of started.runs) sides.push(await stepLiveTest(db.driver, f.members.reviewer, r.run_id, deps, ready));
  expect(sides[0]).toMatchObject({ role: 'clean', status: 'passed', failed_checks: [] });
  expect(sides[0]!.cases[0]).toMatchObject({ queue: 'complaint_review' });
  expect(sides[1]).toMatchObject({ role: 'planted', status: 'failed' });
  expect(sides[1]!.failed_checks.map((c) => c.id)).toContain('right_queue');
  expect(sides[1]!.failed_checks.find((c) => c.id === 'right_queue')!.en).toBeTruthy();
  expect(sides[1]!.cases[0]!.queue).not.toBe('complaint_review');
  expect(sides[0]!.reply).toContain('human review');
  // Older queued conversations from other runs were left alone.
  expect((await db.owner.query<{ n: number }>("SELECT count(*)::int n FROM nazir.conversations WHERE status='queued'")).rows[0]!.n).toBe(stray);
  // Another member cannot read or drive these runs.
  await expect(readLiveSides(db.driver, f.members.supplier, [started.runs[0]!.run_id])).rejects.toThrow();
  await expect(stepLiveTest(db.driver, f.members.supplier, started.runs[0]!.run_id, deps, ready)).rejects.toThrow();
  expect((await readLiveSides(db.driver, f.members.reviewer, started.runs.map((r) => r.run_id))).map((s) => s.status)).toEqual(['passed', 'failed']);
});

it('runs the clean side only when the switch is off, and caps tests per member', async () => {
  const one = await startLiveTest(db.driver, f.members.author, { language: 'ar', complaint: 'تأخر تجديد تصريحي SR-1042 وهذه شكوى.' }, ready);
  expect(one.runs).toHaveLength(1);
  let refused: unknown;
  for (let i = 0; i < 8 && !refused; i++) await startLiveTest(db.driver, f.members.author, { language: 'en', complaint: `Synthetic complaint number ${i} about a late permit.` }, ready).catch((e) => { refused = e; });
  expect(refused).toBeTruthy();
});
