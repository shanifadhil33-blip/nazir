import { afterAll, beforeAll, expect, it } from 'vitest';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { memoryAiStore, postgresAiStore, type AiStateStore } from '../../src/server/ai/store';
let db: TestDatabase, store: AiStateStore;
beforeAll(async () => { db = await testDatabase(); store = postgresAiStore(db.driver); });
afterAll(async () => { await db?.close(); });
it('atomically enforces a task cap across providers and a provider cap across tasks', async () => {
  expect(await store.reserve('test_run','requesty','model',2,2)).toBe(true);
  expect(await store.reserve('test_run','ovh','model',2,20)).toBe(true);
  expect(await store.reserve('test_run','kilo','model',2,20)).toBe(false);
  expect(await store.reserve('live_demo','requesty','model',10,2)).toBe(true);
  expect(await store.reserve('probe','requesty','model',10,2)).toBe(false);
  const usage = await store.usageToday(); expect(usage.reduce((n,r) => n + r.calls,0)).toBe(3);
});
it('separates test and live task totals', async () => {
  expect(await store.reserve('live_demo','kilo','model',2,100)).toBe(true);
  expect(await store.reserve('live_demo','ovh','model',2,100)).toBe(false);
  expect(await store.reserve('probe','kilo','model',2,100)).toBe(true);
});
it('starts fresh on a new UTC day, ignoring the previous day in SQL', async () => {
  await db.owner.query("UPDATE nazir.ai_usage SET day=(clock_timestamp() AT TIME ZONE 'UTC')::date-1");
  expect(await store.usageToday()).toEqual([]);
  expect(await store.reserve('test_run','requesty','model',1,1)).toBe(true);
  expect(await store.reserve('test_run','requesty','model',1,1)).toBe(false);
});
it('records failed calls and answered calls without charging skips', async () => {
  const at = Date.now();
  const common = { at, task:'test_run' as const, purpose:'agent' as const, provider:'requesty', model:'model', family:'nvidia_nemotron' as const, httpStatus:500, latencyMs:12, failover:false, attemptNo:1 };
  await store.record({ ...common, outcome:'error',reason:'http_5xx' });
  await store.record({ ...common, outcome:'skipped',reason:'cooling',attemptNo:2 });
  const usage = await store.usageToday(); expect(usage[0]).toMatchObject({ calls:1,ok:0,failed:1 });
  expect(await store.reserve('test_run','requesty','model',3,3)).toBe(true);
  await store.record({ ...common,outcome:'ok',reason:'ok',httpStatus:200,attemptNo:3 });
  expect((await store.usageToday())[0]).toMatchObject({ calls:2,ok:1,failed:1 });
});
it('persists cooldowns across store instances and filters expired entries', async () => {
  await store.cool({ provider:'requesty',model:'*',until:Date.now()+3600000,reason:'auth_failed' });
  await store.cool({ provider:'ovh',model:'model',until:Date.now()-10000,reason:'rate_limited' });
  expect(await postgresAiStore(db.driver).activeCooldowns()).toMatchObject([{ provider:'requesty',model:'*',reason:'auth_failed' }]);
  await store.cool({ provider:'requesty',model:'*',until:Date.now()+1000,reason:'rate_limited' });
  expect((await store.activeCooldowns())[0]!.until).toBeGreaterThan(Date.now()+3000000);
  await db.owner.query("UPDATE nazir.ai_cooldowns SET until=clock_timestamp()-interval '1 second'");
  expect(await store.activeCooldowns()).toEqual([]);
});
it.each(['nazir_app','nazir_sandbox','nazir_inspector','nazir_worker'])('%s has no direct table access', async (role) => {
  for (const table of ['ai_usage','ai_cooldowns','ai_calls']) for (const action of [`SELECT * FROM nazir.${table}`,`DELETE FROM nazir.${table}`,`UPDATE nazir.${table} SET model='other'`,`TRUNCATE nazir.${table}`,`INSERT INTO nazir.${table}(model) VALUES('other')`]) {
    await expect(db.driver.transaction(async (conn) => { await conn.query(`SET LOCAL ROLE ${role}`); await conn.query(action); })).rejects.toThrow(/permission denied/);
  }
});
it.each(['nazir_app','nazir_sandbox','nazir_inspector'])('%s cannot execute AI functions', async (role) => {
  const sqls = ["SELECT nazir.ai_reserve('probe','ovh','model',1,1)","SELECT nazir.ai_cool('ovh','model',now(),'rate_limited')",'SELECT * FROM nazir.ai_active_cooldowns()','SELECT * FROM nazir.ai_usage_today()',"SELECT nazir.ai_record(now(),'probe','agent','ovh','model','openai_gpt_oss','skipped','cooling',NULL,0,false,1,NULL,NULL)"];
  for (const sql of sqls) await expect(db.driver.transaction(async (conn) => { await conn.query(`SET LOCAL ROLE ${role}`); await conn.query(sql); })).rejects.toThrow(/permission denied/);
});
it.each(['bad space','bad;sql','', 'x'.repeat(200)])('refuses invalid provider and model identifiers: %s', async (value) => {
  await expect(store.reserve('probe',value,'model',10,10)).rejects.toThrow('Invalid AI reservation');
  await expect(store.reserve('probe','ovh',value,10,10)).rejects.toThrow('Invalid AI reservation');
  await expect(store.cool({ provider:value,model:'model',until:Date.now()+1000,reason:'rate_limited' })).rejects.toThrow('Invalid AI cooldown');
});
it('refuses negative and null caps and invalid tasks without echoing input', async () => {
  await expect(store.reserve('probe','ovh','model',-1,10)).rejects.toThrow('Invalid AI reservation');
  await expect(db.owner.query("SELECT nazir.ai_reserve(NULL,'ovh','model',NULL,1)")).rejects.toThrow('Invalid AI reservation');
  await expect(db.owner.query("SELECT nazir.ai_reserve('secret-input','ovh','model',1,1)")).rejects.toThrow('Invalid AI reservation');
});
it('forces RLS, keeps functions private and stores no prompt or key columns', async () => {
  const tables = (await db.owner.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='nazir'::regnamespace AND relname IN ('ai_calls','ai_usage','ai_cooldowns')")).rows;
  expect(tables).toHaveLength(3); expect(tables.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  const cols = (await db.owner.query("SELECT column_name FROM information_schema.columns WHERE table_schema='nazir' AND table_name IN ('ai_calls','ai_usage','ai_cooldowns')")).rows.map((r) => r.column_name);
  expect(cols.some((name) => /prompt|content|message|key|token/i.test(String(name)))).toBe(false);
  const functions = (await db.owner.query("SELECT proname,prosecdef,proconfig FROM pg_proc WHERE pronamespace='nazir'::regnamespace AND proname IN ('ai_reserve','ai_record','ai_cool','ai_active_cooldowns','ai_usage_today')")).rows;
  expect(functions).toHaveLength(5); expect(functions.every((r) => r.prosecdef && String(r.proconfig).includes('search_path'))).toBe(true);
  await expect(db.driver.transaction(async (conn) => { await conn.query('SET LOCAL ROLE nazir_worker'); await conn.query("SELECT nazir.ai_identifiers('ovh','model')"); })).rejects.toThrow('permission denied');
});
it('memory reservations count failed calls and reset at UTC midnight with independent task caps', async () => {
  let at = Date.UTC(2026,9,19,23,59); const memory = memoryAiStore(() => at);
  expect(await memory.reserve('test_run','ovh','a',1,2)).toBe(true); expect(await memory.reserve('test_run','kilo','b',1,2)).toBe(false);
  expect(await memory.reserve('live_demo','ovh','a',1,2)).toBe(true); expect(await memory.reserve('probe','ovh','a',1,2)).toBe(false);
  at += 120000; expect(await memory.reserve('test_run','ovh','a',1,2)).toBe(true);
});
