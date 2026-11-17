import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { readExternalAgent, saveExternalAgent, testExternalAgent } from '../../src/server/settings/external-agent';
import { readTestPeople, removeTestPeople, saveTestPeople, testPeopleForRun, testPeopleInput } from '../../src/server/safety/test-people';
import { confirmSafety, stopSafety } from '../../src/server/safety/run';
import { domainProof } from '../../src/server/safety/ownership';
let db: TestDatabase;
let a: { member_id: string; workspace_id: string }, b: typeof a;
const resolve = async () => [{ address: '93.184.215.14' }];
beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'test-people-encryption-secret-long-enough'); db = await testDatabase();
  a = await db.bootstrap('People A'); b = await db.bootstrap('People B');
  for (const who of [a, b]) {
    await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [who.workspace_id]);
    await connect(who);
  }
}, 60000);
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });
async function connect(who: typeof a, endpoint = 'https://agent.example.com/chat') {
  await saveExternalAgent(db.driver, who.member_id, { name: 'Staging desk', endpoint, format: 'simple_json' }, undefined, resolve);
  await testExternalAgent(db.driver, who.member_id, { message: 'Hello', language: 'en' }, { resolve, fetcher: async () => Response.json({ reply: 'Hello' }) });
}
async function input(who = a) { return { revision: (await readExternalAgent(db.driver, who.member_id))!.revision!, header: 'Authorization', a: { name: 'Saeed', reference: 'TEST-A-1042', token: 'Bearer staging-A-0123456789' }, b: { name: 'Imran', reference: 'TEST-B-1043', token: 'Bearer staging-B-0123456789' } }; }
it('encrypts login tokens and returns only an owner-scoped masked projection', async () => {
  const values = await input(), view = await saveTestPeople(db.driver, a.member_id, values);
  expect(view).toMatchObject({ configured: true, header: 'Authorization', a: { name: 'Saeed', reference: 'TEST-A-1042' }, b: { name: 'Imran', reference: 'TEST-B-1043' } });
  expect(JSON.stringify(view)).not.toContain('staging-');
  const raw = (await db.owner.query<{ cipher: string; metadata: unknown }>('SELECT cipher,metadata FROM nazir.safety_test_people WHERE workspace_id=$1', [a.workspace_id])).rows[0]!;
  expect(raw.cipher).not.toContain(values.a.token); expect(JSON.stringify(raw.metadata)).not.toContain('token');
  expect(await readTestPeople(db.driver, b.member_id)).toBeNull();
  for (const who of [a, b]) await expect(db.member(who.member_id, sql => sql.query('SELECT * FROM nazir.safety_test_people'))).rejects.toThrow(/permission denied/);
  const viewer = await db.createMember(a.workspace_id, ['viewer']);
  await expect(readTestPeople(db.driver, viewer)).rejects.toThrow(/cannot do this/);
});
it('rejects contained-traffic headers, reused identities and stale connection setup', async () => {
  const values = await input();
  for (const header of ['X-Nazir-Mode', 'Traceparent', 'Host', 'Cookie', 'Authorization\nOther']) expect(testPeopleInput.safeParse({ ...values, header }).success).toBe(false);
  expect(testPeopleInput.safeParse({ ...values, b: { ...values.b, token: values.a.token } }).success).toBe(false);
  expect(testPeopleInput.safeParse({ ...values, b: { ...values.b, reference: values.a.reference } }).success).toBe(false);
  await connect(a);
  await expect(saveTestPeople(db.driver, a.member_id, values)).rejects.toMatchObject({ status: 409 });
  expect(await readTestPeople(db.driver, a.member_id)).toBeNull();
});
it('freezes credentials for one run, never exposes them to members, and removes them when stopped', async () => {
  const values = await input(), saved = (await saveTestPeople(db.driver, a.member_id, values))!, connection = (await readExternalAgent(db.driver, a.member_id))!;
  const proof = domainProof(a.workspace_id, connection); await confirmSafety(db.driver, a.member_id, { resolve, fetcher: async () => new Response(proof.token) });
  const run = (await db.member(a.member_id, sql => sql.query<{ id: string }>("SELECT nazir.safety_start('replies_only','NZC-12345678',$1,'Staging desk',$2::jsonb,$3) AS id", [connection.revision, JSON.stringify([{ id: 'S10-en', family: 'S10', language: 'en', goal: 'other_data', turns: ['Test'] }]), saved.id]))).rows[0]!.id;
  await saveTestPeople(db.driver, a.member_id, { ...values, a: { ...values.a, token: 'Bearer changed-A-0123456789' } });
  expect((await testPeopleForRun(db.driver, a.workspace_id, run))?.a.token).toBe(values.a.token);
  expect(await testPeopleForRun(db.driver, b.workspace_id, run)).toBeNull();
  await expect(db.member(a.member_id, sql => sql.query('SELECT * FROM nazir.safety_run_people'))).rejects.toThrow(/permission denied/);
  await stopSafety(db.driver, a.member_id, run);
  expect(await testPeopleForRun(db.driver, a.workspace_id, run)).toBeNull();
  await removeTestPeople(db.driver, a.member_id); expect(await readTestPeople(db.driver, a.member_id)).toBeNull();
});
