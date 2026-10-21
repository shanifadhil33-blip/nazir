import 'server-only';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { createRunnerFixture } from './fixture';
import { loadLibrary } from '../library/load';
import { importLibrary, approveScenario } from '../library/import';
async function prepare(db:SqlConnection) {
  const fixture=await createRunnerFixture(db,'Nazir library fixture',{ includeComplaintScenarios:false });
  const wid=fixture.workspaceId;
  const member=async (email:string,name:string,role:string) => {
    let id=(await db.query<{ id:string }>('SELECT m.id FROM nazir.members m JOIN nazir.users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND u.email=$2',[wid,email])).rows[0]?.id;
    if(!id) {
      const uid=(await db.query<{id:string}>('INSERT INTO nazir.users(email,name) VALUES($1,$2) RETURNING id',[email,name])).rows[0]!.id;
      id=(await db.query<{id:string}>('INSERT INTO nazir.members(workspace_id,user_id,display_name) VALUES($1,$2,$3) RETURNING id',[wid,uid,name])).rows[0]!.id;
      await db.query('INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES($1,$2,$3)',[wid,id,role]);
    }
    return id;
  };
  // The bootstrap member is the author, the second man is the reviewer.
  const author=(await db.query<{id:string}>("SELECT m.id FROM nazir.members m JOIN nazir.member_roles r ON r.member_id=m.id AND r.workspace_id=m.workspace_id AND r.role='service_owner' WHERE m.workspace_id=$1 ORDER BY m.created_at,m.id LIMIT 1",[wid])).rows[0]!.id;
  const reviewer=await member('library_reviewer@example.test','Khalid Hamdan','quality_reviewer');
  // N15: a supplier maintainer who proposes repairs (never the reviewer who decides them).
  const supplier=await member('library_supplier@example.test','Yusuf Rahman','supplier_maintainer');
  return { fixture,wid,author,reviewer,supplier };
}
// Import only when a scenario is missing or its content changed, so a replay writes no rows or audit (21 Oct 2026).
const libraryStale=async (db:SqlConnection,wid:string,library:Awaited<ReturnType<typeof loadLibrary>>) => {
  const rows=(await db.query<{stable_key:string;library_hash:string}>('SELECT DISTINCT ON (stable_key) stable_key,library_hash FROM nazir.scenarios WHERE workspace_id=$1 AND library_hash IS NOT NULL ORDER BY stable_key,version DESC',[wid])).rows;
  const have=new Map(rows.map((r) => [r.stable_key,r.library_hash]));
  return library.some((f) => f.meanings.some((m) => m.scenarios.some((x) => have.get(x.stable_key)!==x.content_hash)));
};
const draftIds=async (db:SqlConnection,wid:string) => (await db.query<{id:string}>("SELECT id FROM nazir.scenarios WHERE workspace_id=$1 AND library_hash IS NOT NULL AND status='draft'",[wid])).rows.map((r) => r.id);
async function finish(db:SqlConnection,prep:Awaited<ReturnType<typeof prepare>>,families:string[]) {
  const plan=(await db.query<{id:string}>('SELECT id FROM nazir.plans WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 1',[prep.wid])).rows[0]!;
  // Plans are prepared before any run uses this fixture.
  await db.query("UPDATE nazir.plans SET budget_calls=80,stop_rules='{}',families=$2 WHERE id=$1 AND (budget_calls<>80 OR stop_rules<>'{}'::jsonb OR families<>$2::text[])",[plan.id,families]);
  const scenarios=(await db.query<{id:string;stable_key:string}>("SELECT id,stable_key FROM nazir.scenarios WHERE workspace_id=$1 AND library_hash IS NOT NULL ORDER BY stable_key,version",[prep.wid])).rows;
  return { workspaceId:prep.wid,planId:plan.id,versions:prep.fixture.versions,members:{ author:prep.author,reviewer:prep.reviewer,supplier:prep.supplier },scenarios:Object.fromEntries(scenarios.map((s) => [s.stable_key,s.id])) };
}
// One owner transaction. Nested member operations use the same reserved connection (tests, local owner with every role).
export async function createLibraryFixture(db:SqlConnection) {
  const prep=await prepare(db);
  const library=await loadLibrary();
  const nested:TransactionDriver={ transaction:async (fn) => { try { return await fn(db); } finally { await db.query('RESET ROLE'); } } };
  if(await libraryStale(db,prep.wid,library)) await importLibrary(nested,prep.author,library);
  for(const id of await draftIds(db,prep.wid)) await approveScenario(nested,prep.reviewer,id);
  return finish(db,prep,library.map((item)=>item.family));
}
// Hosted database: the owner role cannot assume nazir_app, so imports and approvals go through the app login
// (real withMember checks), between two committed owner transactions.
export async function createLibraryFixtureStaged(owner:TransactionDriver,member:TransactionDriver) {
  const prep=await owner.transaction(prepare);
  const library=await loadLibrary();
  if(await owner.transaction((db) => libraryStale(db,prep.wid,library))) await importLibrary(member,prep.author,library);
  for(const id of await owner.transaction((db) => draftIds(db,prep.wid))) await approveScenario(member,prep.reviewer,id);
  return owner.transaction((db) => finish(db,prep,library.map((item)=>item.family)));
}
