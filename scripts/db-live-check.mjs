import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
import { loadTs } from './load-ts.mjs';

/** One transaction, including all expected failures isolated by savepoints. Always rolled back. */
export async function runLiveCheck(db, audit, report = console.log) {
  let failed = false;
  async function check(name, work) {
    await db.query('SAVEPOINT live_check');
    try {
      if (await work() === false) throw new Error('Assertion failed');
      report(`PASS ${name}`);
    } catch {
      failed = true;
      report(`FAIL ${name}`);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT live_check');
      await db.query('RELEASE SAVEPOINT live_check');
    }
  }
  async function denied(sql, params, code) {
    try { await db.query(sql, params); return false; }
    catch (error) { return error.code === code; }
  }
  await db.query('BEGIN');
  try {
    await check('login requires role switch', () => denied('SELECT * FROM nazir.workspaces', undefined, '42501'));
    await db.query('SET LOCAL ROLE nazir_worker');
    const suffix = crypto.randomUUID();
    const a = (await db.query("SELECT * FROM nazir.bootstrap_workspace($1,'Live A','Live A','demo')", [`a.${suffix}@example.test`])).rows[0];
    const b = (await db.query("SELECT * FROM nazir.bootstrap_workspace($1,'Live B','Live B','demo')", [`b.${suffix}@example.test`])).rows[0];
    // Seed B as its member so the rule pack isolation check is not vacuous.
    await db.query('SET LOCAL ROLE nazir_app');
    await db.query("SELECT set_config('app.member_id',$1,true)", [b.member_id]);
    await db.query("INSERT INTO nazir.rule_packs(workspace_id,key,title) VALUES($1,'live_b','Live B')", [b.workspace_id]);
    await db.query("SELECT set_config('app.member_id',$1,true)", [a.member_id]);
    for (const table of ['workspaces', 'members', 'rule_packs', 'audit_events']) {
      await check(`workspace separation ${table}`, async () => {
        const col = table === 'workspaces' ? 'id' : 'workspace_id';
        return (await db.query(`SELECT * FROM nazir.${table} WHERE ${col}=$1`, [b.workspace_id])).rows.length === 0;
      });
    }
    await check('cross workspace insert denied', () => denied("INSERT INTO nazir.rule_packs(workspace_id,key,title) VALUES($1,'bad','bad')", [b.workspace_id], '42501'));
    for (let i = 0; i < 3; i++) await db.query("SELECT nazir.append_audit('live.check','workspace',$1,'{}')", [a.workspace_id]);
    await check('audit chain verifies', async () => {
      const result = audit.verifyAuditChain(await audit.readAuditChain(db, a.workspace_id));
      return result.ok && result.count === 4;
    });
    await check('audit update denied', () => denied("UPDATE nazir.audit_events SET action='bad' WHERE workspace_id=$1", [a.workspace_id], '42501'));
    await check('audit delete denied', () => denied('DELETE FROM nazir.audit_events WHERE workspace_id=$1', [a.workspace_id], '42501'));
    const pack = (await db.query("INSERT INTO nazir.rule_packs(workspace_id,key,title) VALUES($1,'live_a','Live A') RETURNING id", [a.workspace_id])).rows[0];
    const version = (await db.query("INSERT INTO nazir.rule_pack_versions(workspace_id,rule_pack_id,version,status,content) VALUES($1,$2,1,'approved','{}') RETURNING id", [a.workspace_id, pack.id])).rows[0];
    await check('approved content immutable', () => denied("UPDATE nazir.rule_pack_versions SET content='{\"changed\":true}' WHERE id=$1", [version.id], 'P0001'));
  } catch {
    failed = true;
    report('FAIL live check setup');
  } finally {
    await db.query('ROLLBACK');
  }
  return !failed;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) {
    console.error('FAIL DATABASE_URL required');
    process.exitCode = 1;
  } else {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let db;
    try {
      db = await pool.connect();
      const audit = await loadTs('../src/server/audit/verify.ts');
      if (!await runLiveCheck(db, audit)) process.exitCode = 1;
    } catch {
      console.error('FAIL live check connection');
      process.exitCode = 1;
    } finally {
      db?.release();
      await pool.end();
    }
  }
}
