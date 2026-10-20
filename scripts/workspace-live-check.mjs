// Cross workspace live check for the N15 to N17 tables (app login, DATABASE_URL). One transaction, always rolled back. Prints PASS or FAIL only.
import { Pool } from '@neondatabase/serverless';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect(); let failed = false;
const report = (ok, name) => { if (!ok) failed = true; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
async function check(name, work) {
  await db.query('SAVEPOINT c');
  try { report(await work() !== false, name); } catch { report(false, name); }
  finally { await db.query('ROLLBACK TO SAVEPOINT c'); await db.query('RELEASE SAVEPOINT c'); }
}
async function refused(sql, params) { try { await db.query(sql, params); return false; } catch (e) { return ['42501', '23503', 'P0001'].includes(e.code); } }
const tables = ['comparisons', 'proposals', 'approvals', 'lessons', 'lesson_revisions', 'plans', 'runs', 'findings', 'agent_versions'];
try {
  await db.query('BEGIN');
  await db.query('SET LOCAL ROLE nazir_worker');
  const fixture = (await db.query('SELECT nazir.runner_library_fixture_workspace() AS id')).rows[0].id;
  const b = (await db.query("SELECT * FROM nazir.bootstrap_workspace($1,'Live B','Live B','demo')", [`crossb.${crypto.randomUUID()}@example.test`])).rows[0];
  await db.query("SELECT set_config('app.workspace_id',$1,true)", [fixture]);
  const own = {};
  for (const t of tables) own[t] = Number((await db.query(`SELECT count(*) n FROM nazir.${t}`)).rows[0].n);
  console.log(`fixture rows seen by its own worker context: ${JSON.stringify(own)}`);
  const fixtureRun = (await db.query('SELECT id FROM nazir.runs ORDER BY created_at LIMIT 1')).rows[0]?.id;
  const fixtureRun2 = (await db.query('SELECT id FROM nazir.runs ORDER BY created_at DESC LIMIT 1')).rows[0]?.id;
  // Workspace B as its own owner member.
  await db.query('SET LOCAL ROLE nazir_app');
  await db.query("SELECT set_config('app.member_id',$1,true)", [b.member_id]);
  for (const t of tables) await check(`B owner sees none of the fixture ${t}`, async () => Number((await db.query(`SELECT count(*) n FROM nazir.${t} WHERE workspace_id=$1`, [fixture])).rows[0].n) === 0);
  await check('B owner cannot insert a lesson into the fixture', () => refused("INSERT INTO nazir.lessons(workspace_id,text,scope,created_by_type) VALUES($1,'cross','small','member')", [fixture]));
  await check('B owner cannot insert a comparison into the fixture', () => refused("INSERT INTO nazir.comparisons(workspace_id,run_a_id,run_b_id,created_by,comparer_version,summary,pairs) VALUES($1,$2,$3,$4,'n17','{}','[]')", [fixture, fixtureRun, fixtureRun2, b.member_id]));
  await check('B owner cannot update fixture lessons', async () => (await db.query("UPDATE nazir.lessons SET text='cross' WHERE workspace_id=$1", [fixture])).rowCount === 0);
  // Worker with B context.
  await db.query('SET LOCAL ROLE nazir_worker');
  await db.query("SELECT set_config('app.workspace_id',$1,true)", [b.workspace_id]);
  for (const t of tables) await check(`B worker context sees none of the fixture ${t}`, async () => Number((await db.query(`SELECT count(*) n FROM nazir.${t} WHERE workspace_id=$1`, [fixture])).rows[0].n) === 0);
  await check('B worker context cannot insert a lesson into the fixture', () => refused("INSERT INTO nazir.lessons(workspace_id,text,scope,created_by_type,status) VALUES($1,'cross','small','nazir','active')", [fixture]));
} finally {
  await db.query('ROLLBACK').catch(() => {}); db.release(); await pool.end();
}
console.log(failed ? 'exit 1' : 'exit 0'); process.exitCode = failed ? 1 : 0;
