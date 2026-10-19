import { Pool } from '@neondatabase/serverless';

// Live check for the fictional service records (schema sandbox). One transaction, always rolled back, prints PASS or FAIL lines only.
if (!process.env.DATABASE_URL) { console.error('FAIL DATABASE_URL required'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();
let failed = false;
async function check(name, work) {
  await db.query('SAVEPOINT s');
  try { if (await work() === false) throw new Error('Assertion failed'); console.log(`PASS ${name}`); }
  catch { failed = true; console.log(`FAIL ${name}`); }
  finally { await db.query('ROLLBACK TO SAVEPOINT s'); }
}
async function refused(sql, params) { try { await db.query(sql, params); return false; } catch { return true; } }
try {
  await db.query('BEGIN');
  const tenant = `live_${Date.now()}`;
  await db.query('SET LOCAL ROLE nazir_worker');
  await db.query("SELECT set_config('app.workspace_id','00000000-0000-0000-0000-000000000000',true)");
  await db.query('SELECT sandbox.seed_tenant($1)', [tenant]);
  await check('worker cannot read sandbox cases', () => refused('SELECT * FROM sandbox.cases'));
  await db.query('SET LOCAL ROLE nazir_sandbox');
  await db.query("SELECT set_config('app.sandbox_tenant',$1,true), set_config('app.requester_key','saeed',true)", [tenant]);
  const created = (await db.query("INSERT INTO sandbox.cases(tenant,requester_key,category,summary,prior_request_ref,queue,idempotency_key) VALUES($1,'saeed','complaint','Live check','SR-1042','complaint_review','live-1') RETURNING id, reference", [tenant])).rows[0];
  await check('case reference format', () => /^NZ-\d{6}$/.test(created.reference));
  await check('duplicate idempotency key refused', () => refused("INSERT INTO sandbox.cases(tenant,requester_key,category,summary,prior_request_ref,queue,idempotency_key) VALUES($1,'saeed','complaint','Again','SR-1042','complaint_review','live-1')", [tenant]));
  await db.query("INSERT INTO sandbox.escalations(tenant,case_id,queue,reason,idempotency_key) VALUES($1,$2,'complaint_review','Live check','live-2')", [tenant, created.id]);
  await check('second escalation for the same case refused', () => refused("INSERT INTO sandbox.escalations(tenant,case_id,queue,reason) VALUES($1,$2,'complaint_review','Again')", [tenant, created.id]));
  await check('sandbox role cannot read nazir schema', () => refused('SELECT * FROM nazir.workspaces'));
  await check('case cannot be deleted', () => refused('DELETE FROM sandbox.cases WHERE id=$1', [created.id]));
  await db.query("SELECT set_config('app.requester_key','imran',true)");
  await check('another requester sees no case', async () => (await db.query('SELECT * FROM sandbox.cases WHERE reference=$1', [created.reference])).rows.length === 0);
  await db.query("SELECT set_config('app.requester_key','saeed',true)");
  await check('own requester sees case and escalation', async () => (await db.query('SELECT c.reference FROM sandbox.cases c JOIN sandbox.escalations e ON e.case_id=c.id WHERE c.id=$1', [created.id])).rows.length === 1);
} catch {
  failed = true; console.log('FAIL sandbox live check setup');
} finally {
  await db.query('ROLLBACK'); db.release(); await pool.end();
}
process.exitCode = failed ? 1 : 0;
