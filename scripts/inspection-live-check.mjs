import { Pool } from '@neondatabase/serverless';

// Run only by explicit operator action. No connection details are printed.
if (!process.env.DATABASE_URL || !process.env.INSPECT_DATABASE_URL) {
  console.log('FAIL DATABASE_URL and INSPECT_DATABASE_URL required'); process.exit(1);
}
const appPool = new Pool({ connectionString: process.env.DATABASE_URL });
const inspectPool = new Pool({ connectionString: process.env.INSPECT_DATABASE_URL });
let app, inspect;
let failed = false;
async function check(db, name, work) {
  await db.query('SAVEPOINT inspection_check');
  try {
    if (await work() === false) throw new Error('Assertion failed');
    console.log(`PASS ${name}`);
  } catch { failed = true; console.log(`FAIL ${name}`); }
  finally { await db.query('ROLLBACK TO SAVEPOINT inspection_check'); }
}
async function refused(db, sql) { try { await db.query(sql); return false; } catch { return true; } }
try {
  app = await appPool.connect(); inspect = await inspectPool.connect();
  await app.query('BEGIN'); await inspect.query('BEGIN');
  const tenant = `inspect_live_${Date.now()}`;
  const fixtureTenant = process.env.INSPECT_CHECK_TENANT;
  if (fixtureTenant && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(fixtureTenant)) throw new Error('Invalid fixture tenant');
  await app.query('SET LOCAL ROLE nazir_worker');
  await app.query('SELECT sandbox.seed_tenant($1)', [tenant]);
  await app.query('SET LOCAL ROLE nazir_sandbox');
  await app.query("SELECT set_config('app.sandbox_tenant',$1,true),set_config('app.requester_key','saeed',true)", [tenant]);
  for (const requester of ['saeed','imran']) {
    await app.query("SELECT set_config('app.requester_key',$1,true)", [requester]);
    await app.query("INSERT INTO sandbox.cases(tenant,requester_key,category,summary,queue) VALUES($1,$2,'suggestion','Inspection live check','suggestions') RETURNING reference", [tenant, requester]);
  }
  await check(app, 'app login cannot select inspector', () => refused(app, 'SET LOCAL ROLE nazir_inspector'));
  for (const role of ['nazir_app','nazir_worker','nazir_sandbox']) await check(inspect, `inspect login cannot select ${role}`, () => refused(inspect, `SET LOCAL ROLE ${role}`));
  await inspect.query('SET LOCAL ROLE nazir_inspector');
  await inspect.query("SELECT set_config('app.inspect_tenant',$1,true)", [tenant]);
  // Fresh app fixtures are intentionally uncommitted and must stay invisible.
  await check(inspect, 'uncommitted app fixtures are invisible', async () => (await inspect.query('SELECT reference FROM sandbox.cases WHERE tenant=$1', [tenant])).rows.length === 0);
  // Supply a previously committed synthetic tenant for the positive read proof.
  // Without one this check fails explicitly; the script never commits fixtures.
  await check(inspect, 'inspector reads committed cases of both requesters (INSPECT_CHECK_TENANT)', async () => {
    if (!fixtureTenant) return false;
    await inspect.query("SELECT set_config('app.inspect_tenant',$1,true)", [fixtureTenant]);
    const rows = (await inspect.query('SELECT requester_key FROM sandbox.cases WHERE tenant=$1', [fixtureTenant])).rows;
    return ['saeed', 'imran'].every((key) => rows.some((row) => row.requester_key === key));
  });
  await inspect.query("SELECT set_config('app.inspect_tenant',$1,true)", [tenant]);
  for (const table of ['requesters','prior_requests','cases','escalations','tool_receipts']) {
    for (const sql of [`INSERT INTO sandbox.${table} DEFAULT VALUES`, `UPDATE sandbox.${table} SET tenant=tenant`, `DELETE FROM sandbox.${table}`, `TRUNCATE sandbox.${table}`]) await check(inspect, `inspector refused ${sql.split(' ')[0]} ${table}`, () => refused(inspect, sql));
    await check(inspect, `inspector cannot read another tenant ${table}`, async () => (await inspect.query(`SELECT * FROM sandbox.${table} WHERE tenant<>$1`, [tenant])).rows.length === 0);
  }
  await check(inspect, 'inspector cannot read nazir', () => refused(inspect, 'SELECT * FROM nazir.workspaces'));
} catch { failed = true; console.log('FAIL inspection live check setup'); }
finally {
  for (const db of [app, inspect]) {
    if (db) { try { await db.query('ROLLBACK'); } catch { failed = true; console.log('FAIL rollback'); } db.release(); }
  }
  await appPool.end(); await inspectPool.end();
}
process.exitCode = failed ? 1 : 0;
