import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { readExternalAgent, saveExternalAgent, testExternalAgent, type ExternalTransport } from '../../src/server/settings/external-agent';
import { samplePeople, sampleSdkAgent, type SampleSdkMode } from '../../src/server/connect/sample-sdk-agent';
import { makeSdkKey } from '../../src/server/sdk/keys';
import { ingestInventory, ingestTraces } from '../../src/server/sdk/ingest';
import { saveTestPeople, testPeopleForRun } from '../../src/server/safety/test-people';
import { confirmSafety, safetyStep, startSafety, stopSafety } from '../../src/server/safety/run';
import { readSafety } from '../../src/server/safety/read';

let db: TestDatabase;
const resolve = async () => [{ address: '93.184.215.14' }];
const collector: { url: string; body: string }[] = [];
beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'people-runner-test-secret-long-enough');
  vi.stubEnv('AUTH_URL', 'https://nazir.example.test');
  db = await testDatabase();
  // The real downloadable SDK sends through the real validation, redaction and scoped ingest functions.
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    collector.push({ url, body: String(init.body) });
    const request = new Request(url, init);
    const result = url.endsWith('/traces') ? await ingestTraces(db.driver, request) : await ingestInventory(db.driver, request);
    return Response.json(result, { status: 202 });
  });
}, 60000);
afterAll(async () => { await db?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function setup(mode: SampleSdkMode) {
  const who = await db.bootstrap(`People runner ${crypto.randomUUID()}`);
  await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [who.workspace_id]);
  const { key } = await makeSdkKey(db.driver, who.member_id);
  await saveExternalAgent(db.driver, who.member_id, { endpoint: `https://agent.example.com/${mode}`, format: 'simple_json', name: 'Staging desk', header_name: 'X-Api-Key', secret: key }, undefined, resolve);
  const requests: { session: string; person: string | null; message: string }[] = [];
  const transport: ExternalTransport = { resolve, fetcher: async (url, init) => {
    const headers = new Headers(init.headers);
    const body = JSON.parse(String(init.body));
    requests.push({ session: headers.get('x-nazir-session')!, person: headers.get(samplePeople.header), message: body.message });
    return sampleSdkAgent(new Request(url, { ...init, headers }), mode);
  } };
  await testExternalAgent(db.driver, who.member_id, { message: 'Hello', language: 'en' }, transport);
  const connection = (await readExternalAgent(db.driver, who.member_id))!;
  expect(connection.connection_kind).toBe('sdk');
  await saveTestPeople(db.driver, who.member_id, { revision: connection.revision, ...samplePeople });
  await confirmSafety(db.driver, who.member_id);
  requests.length = 0;
  return { ...who, transport, requests, key };
}
async function startPeople(who: Awaited<ReturnType<typeof setup>>) {
  const { id } = await startSafety(db.driver, who.member_id, 'real');
  // Isolated test fixture narrows the suite, preserving generated S10 prompts and frozen credentials.
  await db.owner.query("DELETE FROM nazir.safety_attempts WHERE run_id=$1 AND family<>'S10'", [id]);
  return id;
}
it.each(['people-private', 'people-open'] as const)('actual SDK %s: proves both logins and judges only actual cross-person data', async mode => {
  const who = await setup(mode), id = await startPeople(who);
  await safetyStep(db.driver, { transport: who.transport });
  const result = await readSafety(db.driver, who.member_id, id);
  expect(result).toMatchObject({ status: 'done', scope: 'full' });
  if (mode === 'people-open') expect(result.weaknesses).toEqual([expect.objectContaining({ family: 'S10', outcome: 'broken', severity: 'critical', proven: 'trace', languages: ['en', 'ar'] })]);
  else { expect(result.resisted).toEqual(['S10']); expect(result.weaknesses).toEqual([]); }
  expect(who.requests).toHaveLength(6);
  expect(new Set(who.requests.map(r => r.session)).size).toBe(6);
  expect(who.requests.every(r => !r.message.includes('Imran'))).toBe(true);
  expect(who.requests.filter(r => r.person === samplePeople.b.token)).toHaveLength(2);
  const sent = (await db.owner.query<{ payload: Record<string, string> }>("SELECT payload FROM nazir.audit_events WHERE target_id=$1 AND action='safety.attack_sent'", [id])).rows;
  expect(sent).toHaveLength(6);
  expect(new Set(sent.map(r => r.payload.variant))).toEqual(new Set(['own_a', 'own_b', 'attack']));
  const persisted = JSON.stringify(result) + JSON.stringify(sent) + JSON.stringify(collector);
  for (const token of [samplePeople.a.token, samplePeople.b.token, who.key]) expect(persisted).not.toContain(token);
  expect(await testPeopleForRun(db.driver, who.workspace_id, id)).toBeNull();
}, 60000);
it('bad positive controls remain unknown and never send the cross-person attack', async () => {
  const who = await setup('people-private');
  const connection = (await readExternalAgent(db.driver, who.member_id))!;
  await saveTestPeople(db.driver, who.member_id, { revision: connection.revision, ...samplePeople, b: { ...samplePeople.b, token: 'incorrect-person-login' } });
  const id = await startPeople(who);
  await safetyStep(db.driver, { transport: who.transport });
  expect((await readSafety(db.driver, who.member_id, id)).weaknesses).toEqual([expect.objectContaining({ family: 'S10', outcome: 'could_not_tell', reason: 'test_people_control' })]);
  expect(who.requests).toHaveLength(4);
}, 60000);
it('Stop during a control aborts the in-flight request and sends no next turn', async () => {
  const who = await setup('people-private'), id = await startPeople(who);
  const calls: AbortSignal[] = [];
  const work = safetyStep(db.driver, { turnGapMs: 0, transport: { resolve, fetcher: async (_url, init) => {
    calls.push(init.signal!);
    // Stop through the same API service, not through manufactured status rows.
    await stopSafety(db.driver, who.member_id, id);
    return new Promise<Response>(() => {});
  } } });
  await work;
  expect(calls.length).toBeGreaterThan(0); expect(calls.length).toBeLessThanOrEqual(2);
  expect(calls.every(signal => signal.aborted)).toBe(true);
  expect((await readSafety(db.driver, who.member_id, id)).status).toBe('stopped');
  expect(await testPeopleForRun(db.driver, who.workspace_id, id)).toBeNull();
}, 30000);

it('a full check with missing safety tool evidence never earns a resisted verdict', async () => {
  const who = await setup('people-private'), id = await startPeople(who);
  await safetyStep(db.driver, { transport: { resolve, fetcher: async () => Response.json({ reply: 'Sorry, I can only share your own cases.' }) }, turnGapMs: 0 });
  const result = await readSafety(db.driver, who.member_id, id);
  expect(result.resisted).toEqual([]);
  expect(result.weaknesses).toEqual([expect.objectContaining({ family: 'S10', outcome: 'could_not_tell', reason: 'test_people_control' })]);
}, 30000);
