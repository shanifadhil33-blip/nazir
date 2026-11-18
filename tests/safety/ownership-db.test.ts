import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { readExternalAgent, saveExternalAgent, testExternalAgent } from '../../src/server/settings/external-agent';
import { confirmSafety, startSafety, stopSafety } from '../../src/server/safety/run';
import { domainProof, safetyOwnership, verifyDomainProof } from '../../src/server/safety/ownership';
import { keyHash } from '../../src/server/sdk/keys';

let db: TestDatabase;
const resolve = async () => [{ address: '93.184.215.14' }];
beforeAll(async () => { vi.stubEnv('AUTH_SECRET', 'test-ownership-secret-long-enough'); db = await testDatabase(); }, 60000);
afterAll(async () => { await db?.close(); vi.unstubAllEnvs(); });
async function agent(label: string) {
  const who = await db.bootstrap(label);
  await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [who.workspace_id]);
  const save = async (endpoint = 'https://agent.example.com/chat') => {
    await saveExternalAgent(db.driver, who.member_id, { endpoint, format: 'simple_json', name: 'Test desk' }, undefined, resolve);
    await testExternalAgent(db.driver, who.member_id, { message: 'Hello', language: 'en' }, { resolve, fetcher: async () => Response.json({ reply: 'Hello' }) });
    return (await readExternalAgent(db.driver, who.member_id))!;
  };
  return { ...who, save, connection: await save() };
}
async function hello(who: { member_id: string }, key: string, session?: string, version = '1.0.0') {
  const sid = session ?? (await db.member(who.member_id, sql => sql.query<{ id: string }>("SELECT nazir.open_test_session('connect') AS id"))).rows[0]!.id;
  await db.driver.transaction(async sql => {
    await sql.query('SET LOCAL ROLE nazir_ingest');
    await sql.query('SELECT nazir.ingest_spans($1,$2,$3::jsonb,$4)', [keyHash(key), sid, JSON.stringify([{ kind: 'nazir.hello', name: 'hello', turn: 1, attributes: {} }]), version]);
  });
  return sid;
}

it('requires the exact public domain file, binds confirmation to the current revision and expires it', async () => {
  const a = await agent('Proof A'), b = await agent('Proof B');
  const proof = domainProof(a.workspace_id, a.connection);
  expect(domainProof(b.workspace_id, b.connection).token).not.toBe(proof.token);
  await expect(db.member(a.member_id, sql => sql.query("SELECT nazir.safety_confirm('agent.example.com')"))).rejects.toThrow(/safety_confirm_needed/);
  await expect(confirmSafety(db.driver, a.member_id, { resolve, fetcher: async () => new Response('wrong') })).rejects.toMatchObject({ code: 'safety_proof_needed' });
  expect((await safetyOwnership(db.driver, a.member_id, a.connection)).confirmed).toBe(false);
  await confirmSafety(db.driver, a.member_id, { resolve, fetcher: async (url, init) => {
    expect(url).toBe('https://agent.example.com/.well-known/nazir-verify.txt');
    expect(init.redirect).toBe('manual'); expect(init.headers).toEqual({ accept: 'text/plain' });
    return new Response(proof.token + '\n');
  } });
  expect((await safetyOwnership(db.driver, a.member_id, a.connection)).confirmed).toBe(true);
  await expect(db.member(a.member_id, sql => sql.query("SELECT nazir.safety_start('full','NZC-12345678',$1,'Test','[]')", [a.connection.revision]))).rejects.toThrow(/safety_sdk_needed/);
  const run = await startSafety(db.driver, a.member_id, 'real'); await stopSafety(db.driver, a.member_id, run.id);
  await db.owner.query("UPDATE nazir.safety_confirmations SET confirmed_at=clock_timestamp()-interval '25 hours' WHERE workspace_id=$1", [a.workspace_id]);
  expect((await safetyOwnership(db.driver, a.member_id, a.connection)).confirmed).toBe(false);
  await expect(startSafety(db.driver, a.member_id, 'real')).rejects.toMatchObject({ code: 'safety_confirm_needed' });
  const changed = await a.save();
  expect(domainProof(a.workspace_id, changed).token).not.toBe(proof.token);
  await expect(confirmSafety(db.driver, a.member_id, { resolve, fetcher: async () => new Response(proof.token) })).rejects.toMatchObject({ code: 'safety_proof_needed' });
});

it('refuses redirects, private DNS, excessive bodies and an endpoint changed while proof was fetched', async () => {
  const a = await agent('Proof transport'); const proof = domainProof(a.workspace_id, a.connection);
  for (const response of [new Response(null, { status: 302, headers: { location: 'https://other.example.com' } }), new Response('x'.repeat(1025))]) {
    await expect(verifyDomainProof(proof, { resolve, fetcher: async () => response })).rejects.toMatchObject({ code: 'safety_proof_needed' });
  }
  const fetcher = vi.fn();
  await expect(verifyDomainProof(proof, { resolve: async () => [{ address: '127.0.0.1' }], fetcher })).rejects.toMatchObject({ code: 'safety_proof_needed' });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(confirmSafety(db.driver, a.member_id, { resolve, fetcher: async () => { await a.save('https://next.example.com/chat'); return new Response(proof.token); } })).rejects.toMatchObject({ code: 'safety_confirm_needed' });
  expect((await db.owner.query('SELECT * FROM nazir.safety_confirmations WHERE workspace_id=$1', [a.workspace_id])).rows).toHaveLength(0);
});

it('accepts a current SDK hello, refuses late old-session hello and revoked keys', async () => {
  const a = await agent('Proof SDK'); const key = 'nzk_' + 'c'.repeat(32) + '_' + 'C'.repeat(40);
  await db.member(a.member_id, sql => sql.query('SELECT nazir.issue_sdk_key($1,$2)', [keyHash(key), 'CCCC']));
  const oldSession = await hello(a, key);
  const sdk = (await readExternalAgent(db.driver, a.member_id))!;
  expect(sdk.connection_kind).toBe('sdk');
  await confirmSafety(db.driver, a.member_id);
  const run = await startSafety(db.driver, a.member_id, 'real');
  expect((await db.owner.query('SELECT scope FROM nazir.safety_runs WHERE id=$1', [run.id])).rows[0]!.scope).toBe('full');
  await stopSafety(db.driver, a.member_id, run.id);
  await db.owner.query("UPDATE nazir.external_agents SET sdk_seen_at=clock_timestamp()-interval '25 hours' WHERE workspace_id=$1", [a.workspace_id]);
  expect((await readExternalAgent(db.driver, a.member_id))?.connection_kind).toBe('api');
  await expect(startSafety(db.driver, a.member_id, 'real')).rejects.toMatchObject({ code: 'safety_confirm_needed' });
  const changed = await a.save('https://new.example.com/chat');
  await hello(a, key, oldSession);
  expect((await readExternalAgent(db.driver, a.member_id))?.connection_kind).toBe('api');
  expect((await safetyOwnership(db.driver, a.member_id, changed)).confirmed).toBe(false);
  await hello(a, key);
  await confirmSafety(db.driver, a.member_id);
  await db.member(a.member_id, sql => sql.query('SELECT nazir.revoke_sdk_key()'));
  expect((await readExternalAgent(db.driver, a.member_id))?.sdk_seen_at).toBeNull();
  await expect(startSafety(db.driver, a.member_id, 'real')).rejects.toMatchObject({ code: 'safety_confirm_needed' });
});

it('requires the contained SDK before full safety can target observed connected tools', async () => {
  const a = await agent('MCP SDK upgrade'); const key = 'nzk_' + 'd'.repeat(32) + '_' + 'D'.repeat(40);
  await db.member(a.member_id, sql => sql.query('SELECT nazir.issue_sdk_key($1,$2)', [keyHash(key), 'DDDD']));
  await hello(a, key);
  const inventory = { tools: [{ name: 'files.delete', source: 'mcp', mcp_server: 'files', changes_data: false }] };
  await db.driver.transaction(async sql => { await sql.query('SET LOCAL ROLE nazir_ingest'); await sql.query('SELECT nazir.ingest_inventory($1,$2,$3::jsonb)', [keyHash(key), 'd'.repeat(64), JSON.stringify(inventory)]); });
  await confirmSafety(db.driver, a.member_id);
  await expect(startSafety(db.driver, a.member_id, 'real')).rejects.toMatchObject({ code: 'safety_sdk_update', status: 409 });
  await hello(a, key, undefined, '1.0.1');
  const run = await startSafety(db.driver, a.member_id, 'real');
  await stopSafety(db.driver, a.member_id, run.id);
});
