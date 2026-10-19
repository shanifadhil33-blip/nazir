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
    await db.query("SELECT set_config('app.workspace_id',$1,true)", [a.workspace_id]);
    const viewer = (await db.query("SELECT nazir.add_member($1,'Live viewer',ARRAY['viewer']) AS id", [`viewer.${suffix}@example.test`])).rows[0].id;
    const supplier = (await db.query("SELECT nazir.add_member($1,'Live supplier',ARRAY['supplier_maintainer','quality_reviewer']) AS id", [`supplier.${suffix}@example.test`])).rows[0].id;
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
      return result.ok && result.count === 6;
    });
    await check('audit update denied', () => denied("UPDATE nazir.audit_events SET action='bad' WHERE workspace_id=$1", [a.workspace_id], '42501'));
    await check('audit delete denied', () => denied('DELETE FROM nazir.audit_events WHERE workspace_id=$1', [a.workspace_id], '42501'));
    const pack = (await db.query("INSERT INTO nazir.rule_packs(workspace_id,key,title) VALUES($1,'live_a','Live A') RETURNING id", [a.workspace_id])).rows[0];
    await db.query("INSERT INTO nazir.rule_pack_versions(workspace_id,rule_pack_id,version,content) VALUES($1,$2,1,'{}') RETURNING id", [a.workspace_id, pack.id]);
    // A different author approves the version; its original owner cannot self approve.
    await db.query("SELECT set_config('app.member_id',$1,true)", [supplier]);
    const supplied = (await db.query("INSERT INTO nazir.rule_pack_versions(workspace_id,rule_pack_id,version,content) VALUES($1,$2,2,'{}') RETURNING id", [a.workspace_id, pack.id])).rows[0];
    await db.query("SELECT set_config('app.member_id',$1,true)", [a.member_id]);
    await db.query("UPDATE nazir.rule_pack_versions SET status='approved' WHERE id=$1", [supplied.id]);
    await check('approved content immutable', () => denied("UPDATE nazir.rule_pack_versions SET content='{\"changed\":true}' WHERE id=$1", [supplied.id], 'P0001'));
    const agent = (await db.query("INSERT INTO nazir.agents(workspace_id,name) VALUES($1,'Live agent') RETURNING id", [a.workspace_id])).rows[0];
    const agentVersion = (await db.query("INSERT INTO nazir.agent_versions(workspace_id,agent_id,label,kind,config) VALUES($1,$2,'Live','baseline','{}') RETURNING id", [a.workspace_id, agent.id])).rows[0];
    const meaning = (await db.query("INSERT INTO nazir.scenario_meanings(workspace_id,family,canonical) VALUES($1,'live','{}') RETURNING id", [a.workspace_id])).rows[0];
    const scenario = (await db.query(`INSERT INTO nazir.scenarios(workspace_id,meaning_id,stable_key,version,family,language,split,persona,starting_state,allowed_actions,forbidden_actions,expected_state,source_clause,expectation_kind,severity,rubric_version)
      VALUES($1,$2,'live',1,'live','en','development','{}','{}','{}','{}','{}','Demo','fictional_demo_rule','low','1') RETURNING id`, [a.workspace_id, meaning.id])).rows[0];
    const plan = (await db.query(`INSERT INTO nazir.plans(workspace_id,goal,agent_version_id,rule_pack_version_id,families,languages,repeats,budget_calls,stop_rules,proposed_by_type)
      VALUES($1,'Live',$2,$3,'{}','{en}',1,10,'{}','member') RETURNING id`, [a.workspace_id, agentVersion.id, supplied.id])).rows[0];
    await db.query('SET LOCAL ROLE nazir_worker');
    const run = (await db.query("INSERT INTO nazir.runs(workspace_id,plan_id,agent_version_id,rule_pack_version_id,frozen_manifest,runner_version) VALUES($1,$2,$3,$4,'{}','1') RETURNING id", [a.workspace_id, plan.id, agentVersion.id, supplied.id])).rows[0];
    const conversation = (await db.query("INSERT INTO nazir.conversations(workspace_id,run_id,scenario_id,language,idempotency_key) VALUES($1,$2,$3,'en','live') RETURNING id", [a.workspace_id, run.id, scenario.id])).rows[0];
    await db.query("INSERT INTO nazir.tool_events(workspace_id,conversation_id,seq,tool_name,request,response,outcome) VALUES($1,$2,1,'live','{}','{}','ok')", [a.workspace_id, conversation.id]);
    const finding = (await db.query(`INSERT INTO nazir.findings(workspace_id,run_id,conversation_id,scenario_id,check_layer,title,agent_said,really_happened,rule_pack_version_id,rule_clause,agent_version_id,severity,root_cause_class,owner_role,evidence)
      VALUES($1,$2,$3,$4,'human','Live','Said','Observed',$5,'1',$6,'low','unknown','service_owner','{}') RETURNING id`, [a.workspace_id, run.id, conversation.id, scenario.id, supplied.id, agentVersion.id])).rows[0];
    await db.query('SET LOCAL ROLE nazir_app');
    await db.query("SELECT set_config('app.member_id',$1,true)", [viewer]);
    await check('viewer cannot read tool_events', async () => (await db.query('SELECT * FROM nazir.tool_events WHERE workspace_id=$1', [a.workspace_id])).rows.length === 0);
    await db.query("SELECT set_config('app.member_id',$1,true)", [supplier]);
    const proposal = (await db.query("INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,evidence) VALUES($1,$2,'member','Read evidence') RETURNING id", [a.workspace_id, finding.id])).rows[0];
    await check('supplier cannot approve own proposal', () => denied(`INSERT INTO nazir.approvals(workspace_id,subject_type,subject_id,decision,reason,decided_by,decided_by_name_at_event,decided_by_roles_at_event)
      VALUES($1,'proposal',$2,'approve','Reviewed',$3,'','{}')`, [a.workspace_id, proposal.id, supplier], 'P0001'));
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
