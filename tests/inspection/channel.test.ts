import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCallback);
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { withSandbox, withWorker } from '../../src/server/db/context';
import * as module from '../../src/server/inspection/channel';
import { inspectionRuntimeDriver } from '../../src/server/db/runtime';
import { createSandboxTools } from '../../src/sandbox/tools';
import type { TransactionDriver } from '../../src/server/db/driver';
let db: TestDatabase;
const tables = ['requesters', 'prior_requests', 'cases', 'escalations', 'tool_receipts'];
beforeAll(async () => {
  db = await testDatabase();
  for (const tenant of ['inspection', 'elsewhere']) {
    await withWorker(db.driver, '00000000-0000-0000-0000-000000000000', (conn) => conn.query('SELECT sandbox.seed_tenant($1)', [tenant]));
    for (const requesterKey of ['saeed', 'imran']) {
      const tools = createSandboxTools({ driver: db.driver, tenant, requesterKey });
      const created = await tools.execute('create_case', { category: 'complaint', summary: 'Delay', requester_name: requesterKey, prior_request_ref: requesterKey === 'saeed' ? 'SR-1042' : 'SR-2077' }, { idempotencyKey: requesterKey });
      if (!created.ok) throw new Error('Missing fixture');
      await tools.execute('request_human_review', { reference: created.data.reference, reason: 'Review' }, { idempotencyKey: requesterKey + '_review' });
    }
  }
});
afterAll(async () => { await db?.close(); });
function asInspector(sql: string) {
  return db.driver.transaction(async (conn) => {
    await conn.query('SET LOCAL ROLE nazir_inspector');
    await conn.query("SELECT set_config('app.inspect_tenant','inspection',true)");
    return conn.query(sql);
  });
}
for (const table of tables) {
  it.each([`INSERT INTO sandbox.${table} DEFAULT VALUES`, `UPDATE sandbox.${table} SET tenant=tenant`, `DELETE FROM sandbox.${table}`, `TRUNCATE sandbox.${table}`])('inspector refuses %s', async (sql) => { await expect(asInspector(sql)).rejects.toThrow(/permission denied/); });
  it(`tenant isolation on ${table}`, async () => {
    expect((await asInspector(`SELECT * FROM sandbox.${table} WHERE tenant='elsewhere'`)).rows).toEqual([]);
    expect((await asInspector(`SELECT * FROM sandbox.${table}`)).rows.every((row) => row.tenant === 'inspection')).toBe(true);
  });
}
it('cannot read any nazir table or use sandbox sequences and functions', async () => {
  const tables = (await db.owner.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='nazir'")).rows;
  for (const { tablename } of tables) await expect(asInspector(`SELECT * FROM nazir.${tablename}`)).rejects.toThrow(/permission denied/);
  await expect(asInspector("SELECT nextval('sandbox.case_reference_seq')")).rejects.toThrow(/permission denied/);
  await expect(asInspector("SELECT sandbox.seed_tenant('inspection')")).rejects.toThrow(/permission denied/);
});
it('reads both requesters and returns typed stable objects and receipt cursors', async () => {
  const channel = module.createInspectionChannel(db.driver);
  const state = await channel.snapshot('inspection');
  expect(state.cases).toHaveLength(2); expect(state.cases.map((c) => c.priorRequestRef).sort()).toEqual(['SR-1042', 'SR-2077']);
  expect(Number.isFinite(Date.parse(state.takenAt))).toBe(true);
  expect(state.cases).toEqual(await channel.listCases('inspection'));
  expect(await channel.readCase('inspection', state.cases[0]!.reference)).toEqual(state.cases[0]);
  expect(await channel.readCase('elsewhere', state.cases[0]!.reference)).toBeNull();
  expect(await channel.readEscalations('inspection', state.cases[0]!.id)).toMatchObject([{ queue: 'complaint_review', status: 'pending_review' }]);
  expect(await channel.readReceipts('inspection', { limit: 1 })).toEqual(state.receipts.slice(0, 1));
  expect(await channel.readReceipts('inspection', { sinceId: state.receipts[0]!.id, limit: 10 })).toEqual(state.receipts.slice(1));
  expect(await channel.readReceipts('inspection', { since: '2100-01-01', limit: 10 })).toEqual([]);
});
it('enforces transaction read only even after selecting the owner role', async () => {
  const owner = (await db.owner.query<{ current_user: string }>('SELECT current_user')).rows[0]!.current_user;
  const driver: TransactionDriver = { transaction: (work) => db.driver.transaction((conn) => work({
    async query(sql, params) {
      if (sql.startsWith('SELECT c.id')) {
        await conn.query(`SET LOCAL ROLE "${owner.replaceAll('"', '""')}"`);
        await conn.query("INSERT INTO sandbox.requesters VALUES('forbidden','test','Test')");
      }
      return conn.query(sql, params);
    },
  })) };
  await expect(module.createInspectionChannel(driver).listCases('inspection')).rejects.toThrow(/read.only transaction/i);
});
it('exports only the read channel with no write method', () => {
  expect(Object.keys(module)).toEqual(['createInspectionChannel']);
  expect(Object.keys(module.createInspectionChannel(db.driver)).sort()).toEqual(['listCases','readCase','readEscalations','readReceipts','snapshot']);
});
it.each(['', 'bad space', "x'; DROP TABLE sandbox.cases", 'a'.repeat(65)])('rejects unsafe tenant %s', (tenant) => {
  const driver = { transaction: vi.fn() }; expect(() => module.createInspectionChannel(driver).snapshot(tenant)).toThrow('Invalid inspection tenant'); expect(driver.transaction).not.toHaveBeenCalled();
});
it('requires separate inspection credentials', () => {
  vi.stubEnv('INSPECT_DATABASE_URL', ''); vi.stubEnv('DATABASE_URL', 'postgres://unused');
  try { expect(() => inspectionRuntimeDriver()).toThrow('INSPECT_DATABASE_URL is required for inspection'); } finally { vi.unstubAllEnvs(); }
});
it('proves login role separation and sandbox cannot select inspector', async () => {
  const db = await testDatabase();
  try {
  await db.owner.query('CREATE ROLE nazir_test_app NOLOGIN NOINHERIT; CREATE ROLE nazir_test_inspect NOLOGIN NOINHERIT; GRANT nazir_app,nazir_worker,nazir_sandbox TO nazir_test_app; GRANT nazir_inspector TO nazir_test_inspect');
  // SET SESSION AUTHORIZATION models separate credentials in the in memory owner connection.
  for (const [login, roles] of [['nazir_test_app', ['nazir_inspector']], ['nazir_test_inspect', ['nazir_app','nazir_worker','nazir_sandbox']]] as const) {
    for (const role of roles) {
      await db.owner.query(`SET SESSION AUTHORIZATION ${login}`);
      try { await expect(db.owner.query(`SET ROLE ${role}`)).rejects.toThrow(/permission denied/); } finally { await db.owner.query('RESET SESSION AUTHORIZATION'); await db.owner.query('RESET ROLE'); }
    }
  }
  // A sandbox role reached through the app credentials has no inspection membership.
  await db.owner.query('SET SESSION AUTHORIZATION nazir_test_app');
  try { await expect(withSandbox(db.driver, { tenant: 'inspection', requesterKey: 'saeed' }, (conn) => conn.query('SET LOCAL ROLE nazir_inspector'))).rejects.toThrow(/permission denied/); } finally { await db.owner.query('RESET SESSION AUTHORIZATION'); await db.owner.query('RESET ROLE'); }  } finally { await db.close(); }
});

it.each(['scripts/inspection-live-check.mjs','scripts/db-roles.mjs'])('parses %s without running it', async (file) => { await expect(execFile(process.execPath, ['--check', file])).resolves.toHaveProperty('stderr', ''); });

it('missing tenant context reads nothing and role context resets after channel reads', async () => {
  await db.driver.transaction(async (conn) => {
    await conn.query('SET LOCAL ROLE nazir_inspector');
    for (const table of tables) expect((await conn.query(`SELECT * FROM sandbox.${table}`)).rows).toEqual([]);
  });
  const before = (await db.owner.query('SELECT current_user')).rows;
  await module.createInspectionChannel(db.driver).snapshot('inspection');
  expect((await db.owner.query('SELECT current_user')).rows).toEqual(before);
});
it.each([{ limit: 0 }, { limit: 10001 }, { limit: 1.5 }, { limit: 1, sinceId: 'bad' }, { limit: 1, since: 'bad' }, { limit: 1, since: '2026-01-01', sinceId: 'x' }])('rejects invalid receipt filters %j', async (filter) => {
  await expect(module.createInspectionChannel(db.driver).readReceipts('inspection', filter)).rejects.toThrow(/Invalid receipt/);
});
