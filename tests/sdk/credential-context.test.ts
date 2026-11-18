import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { saveExternalAgent, testExternalAgent, readExternalAgent } from '../../src/server/settings/external-agent';
import { makeSdkKey, keyHash } from '../../src/server/sdk/keys';
import { ingestTraces, prepareSpans } from '../../src/server/sdk/ingest';
import { credentialScrubber } from '../../src/server/sdk/credentials';
import { saveTestPeople, removeTestPeople } from '../../src/server/safety/test-people';
import { confirmSafety, startSafety, stopSafety } from '../../src/server/safety/run';
import { domainProof } from '../../src/server/safety/ownership';
import { judgeAttack } from '../../src/server/safety/evidence';
import type { Attack } from '../../src/server/safety/attacks';
let db: TestDatabase;
const resolve = async () => [{ address: '93.184.215.14' }];
const globalLogin = 'Bearer global-login/with"quote\\slash-0123456789';
const people = { header: 'X-Test-Person', a: { name: 'Saeed', reference: 'TEST-A-1042', token: 'Bearer person-a/with"quote\\slash-0123456789' }, b: { name: 'Imran', reference: 'TEST-B-1043', token: 'person-b-login-0123456789' } };
beforeAll(async () => { vi.stubEnv('AUTH_SECRET', 'collector-credential-context-test-secret'); db = await testDatabase(); }, 60000);
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });
async function setup() {
  const who = await db.bootstrap('Credential ' + crypto.randomUUID());
  await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [who.workspace_id]);
  await saveExternalAgent(db.driver, who.member_id, { endpoint: 'https://agent.example.com/chat', format: 'simple_json', name: 'Test desk', header_name: 'X-Agent-Key', secret: globalLogin }, undefined, resolve);
  await testExternalAgent(db.driver, who.member_id, { message: 'Hello', language: 'en' }, { resolve, fetcher: async () => Response.json({ reply: 'Hello' }) });
  const { key } = await makeSdkKey(db.driver, who.member_id), connection = (await readExternalAgent(db.driver, who.member_id))!;
  await saveTestPeople(db.driver, who.member_id, { ...people, revision: connection.revision });
  const proof = domainProof(who.workspace_id, connection);
  await confirmSafety(db.driver, who.member_id, { resolve, fetcher: async () => new Response(proof.token) });
  const { id } = await startSafety(db.driver, who.member_id, 'real');
  const attempt = (await db.owner.query<{ id: string; attack: Attack }>("UPDATE nazir.safety_attempts SET status='running' WHERE run_id=$1 AND family='S10' AND language='en' RETURNING id,attack", [id])).rows[0]!;
  const session = (await db.worker(who.workspace_id, sql => sql.query<{ id: string }>("SELECT nazir.open_test_session('security',$1,$2) AS id", [id, attempt.id]))).rows[0]!.id;
  return { ...who, key, run: id, session, attempt, revision: connection.revision };
}
const rawSpan = (attributes: Record<string, unknown> = {}) => ({ kind: 'execute_tool', name: 'read', turn: 1, status: 'OK', attributes });
function request(who: { key: string; session: string }, spans = [rawSpan()]) {
  return new Request('https://nazir.example.test/api/v1/traces', { method: 'POST', headers: { authorization: 'Bearer ' + who.key, 'content-type': 'application/json' }, body: JSON.stringify({ sdk: { name: 'test', version: '1.0.1' }, session: who.session, turn: 1, spans }) });
}
async function saved(session: string) { return (await db.owner.query<{ attributes: Record<string, unknown>; kind: string; name: string; status: string; turn: number }>('SELECT attributes,kind,name,status,turn FROM nazir.trace_spans WHERE session_id=$1', [session])).rows; }
it('scrubs frozen, bare and JSON-escaped login echoes everywhere before saving while retaining proof', async () => {
  const who = await setup();
  // A setup edit must not replace the values needed to scrub this run's already issued logins.
  await saveTestPeople(db.driver, who.member_id, { ...people, revision: who.revision, a: { ...people.a, token: 'replacement-login-0123456789' } });
  const values = [who.key, globalLogin, globalLogin.slice(7), people.a.token, people.a.token.slice(7), people.b.token];
  const attributes = { arbitrary: values, 'gen_ai.tool.call.result': JSON.stringify({ detail: people.a.token, nested: JSON.stringify({ value: globalLogin }) }), ['echo-' + people.b.token]: people.b.token };
  expect(await ingestTraces(db.driver, request(who, [rawSpan(attributes)]))).toEqual({ accepted: 1 });
  const rows = await saved(who.session), stored = JSON.stringify(rows);
  for (const token of values) { expect(stored).not.toContain(token); expect(stored).not.toContain(JSON.stringify(token).slice(1, -1)); }
  expect(rows[0]!.attributes['nazir.credentials_redacted']).toBe(true);
  expect(judgeAttack({ attack: who.attempt.attack, reply: 'Sorry, I cannot share another case.', spans: rows, canary: 'NZC-12345678', canaryHit: false, changingTools: [], inventoryTools: [] })).toMatchObject({ outcome: 'broken', severity: 'critical', proven: 'trace' });
  const ancestry = (await db.owner.query('SELECT run_id,conversation_id FROM nazir.test_sessions WHERE id=$1', [who.session])).rows[0];
  expect(ancestry).toEqual({ run_id: who.run, conversation_id: who.attempt.id });
});
it.each(['removed', 'stopped', 'done', 'changed', 'revoked'] as const)('rejects late security echoes after credentials are %s without storing them', async action => {
  const who = await setup();
  if (action === 'removed') await removeTestPeople(db.driver, who.member_id);
  if (action === 'stopped') await stopSafety(db.driver, who.member_id, who.run);
  if (action === 'done') await db.owner.query("UPDATE nazir.safety_runs SET status='done' WHERE id=$1", [who.run]);
  if (action === 'changed') await saveExternalAgent(db.driver, who.member_id, { endpoint: 'https://agent.example.com/new', format: 'simple_json', name: 'New desk' }, undefined, resolve);
  if (action === 'revoked') await db.member(who.member_id, sql => sql.query('SELECT nazir.revoke_sdk_key()'));
  await expect(ingestTraces(db.driver, request(who, [rawSpan({ arbitrary: people.a.token })]))).rejects.toMatchObject({ status: action === 'revoked' ? 401 : 403 });
  expect(await saved(who.session)).toEqual([]);
});
it('validates the key and exact question before opening context, and exposes no cipher to members', async () => {
  const a = await setup(), b = await setup();
  await expect(ingestTraces(db.driver, request({ ...a, key: b.key }))).rejects.toMatchObject({ status: 403 });
  for (const method of [
    () => db.member(a.member_id, sql => sql.query('SELECT nazir.sdk_trace_context($1,$2)', [keyHash(a.key), a.session])),
    () => db.member(a.member_id, sql => sql.query('SELECT nazir.store_sdk_spans($1,$2,$3::jsonb,$4)', [keyHash(a.key), a.session, '[]', '1.0.1'])),
    () => db.member(a.member_id, sql => sql.query("SELECT nazir.open_test_session('security',$1,$2)", [a.run, a.attempt.id])),
    () => db.worker(b.workspace_id, sql => sql.query("SELECT nazir.open_test_session('security',$1,$2)", [a.run, a.attempt.id])),
  ]) await expect(method()).rejects.toThrow(/permission denied|Invalid safety question/);
  const unbound = (await db.member(a.member_id, sql => sql.query<{ id: string }>("SELECT nazir.open_test_session('security') AS id"))).rows[0]!.id;
  await expect(ingestTraces(db.driver, request({ ...a, session: unbound }))).rejects.toMatchObject({ status: 403 });
  await db.driver.transaction(async sql => { await sql.query('SET LOCAL ROLE nazir_ingest'); await expect(sql.query('SELECT nazir.store_sdk_spans($1,$2,$3::jsonb,$4)', [keyHash(a.key), a.session, '[]', '1.0.1'])).rejects.toThrow(/permission denied/); });
});
it('preserves the SDK boolean flag beyond the ordinary attribute cap and masks before cutting long values', () => {
  const attributes = Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['field' + i, i]));
  const prepared = prepareSpans({ sdk: { version: '1.0.1', name: 'test' }, session: 'ses_' + 'a'.repeat(32), turn: 1, spans: [rawSpan({ ...attributes, 'nazir.credentials_redacted': true, password: 'dropped' })] });
  expect(prepared.spans[0]!.attributes['nazir.credentials_redacted']).toBe(true);
  expect(prepared.spans[0]!.attributes).not.toHaveProperty('password');
  const scrub = credentialScrubber([people.b.token]);
  const result = scrub('x'.repeat(8190) + people.b.token);
  expect(result.found).toBe(true); expect(String(result.value).slice(0, 8192)).not.toContain(people.b.token.slice(0, 2));
});
