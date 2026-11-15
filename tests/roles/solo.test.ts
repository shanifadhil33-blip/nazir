import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { seed, testDatabase, type TestDatabase } from '../helpers/pglite';
let db: TestDatabase;
let s: Awaited<ReturnType<typeof seed>>;
beforeAll(async () => {
  db = await testDatabase(); s = await seed(db, 'SoloOwner');
  // A real workspace with one person, like every new account.
  await db.owner.query("UPDATE nazir.workspaces SET kind='real' WHERE id=$1", [s.workspace_id]);
  for (const role of ['quality_reviewer', 'supplier_maintainer']) await db.owner.query('INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [s.workspace_id, s.member_id, role]);
});
afterAll(async () => { await db?.close(); });
async function propose(member: string) {
  const row = (await db.owner.query<{ row: Record<string, unknown> }>('SELECT to_jsonb(t) AS row FROM nazir.proposals t WHERE id=$1', [s.ids.proposals])).rows[0]!.row;
  return (await db.member(member, (sql) => sql.query<{ id: string }>('INSERT INTO nazir.proposals SELECT (jsonb_populate_record(NULL::nazir.proposals,$1::jsonb)).* RETURNING id', [JSON.stringify({ ...row, id: randomUUID(), status: 'proposed' })]))).rows[0]!.id;
}
const approve = (member: string, id: string) => db.member(member, async (sql) => {
  const row = (await sql.query<{ self_approved: boolean }>("INSERT INTO nazir.approvals(workspace_id,subject_type,subject_id,decision,reason,decided_by,decided_by_name_at_event,decided_by_roles_at_event) VALUES(nazir.current_workspace_id(),'proposal',$1,'approve','I checked this fix myself',$2,'','{}') RETURNING self_approved", [id, member])).rows[0]!;
  await sql.query("UPDATE nazir.proposals SET status='approved' WHERE id=$1", [id]);
  return row;
});

it('gives a new real owner all three flow roles', async () => {
  const user = (await db.owner.query<{ id: string }>("INSERT INTO nazir.users(email,name) VALUES($1,'New') RETURNING id", [`${randomUUID()}@example.test`])).rows[0]!;
  const w = (await db.owner.query<{ id: string }>("INSERT INTO nazir.workspaces(name,kind,created_by) VALUES('Mine','real',$1) RETURNING id", [user.id])).rows[0]!;
  const m = (await db.owner.query<{ id: string }>("INSERT INTO nazir.members(workspace_id,user_id,display_name) VALUES($1,$2,'New') RETURNING id", [w.id, user.id])).rows[0]!;
  await db.owner.query("INSERT INTO nazir.member_roles(workspace_id,member_id,role) VALUES($1,$2,'service_owner')", [w.id, m.id]);
  expect((await db.owner.query<{ role: string }>('SELECT role FROM nazir.member_roles WHERE member_id=$1 ORDER BY role', [m.id])).rows.map((r) => r.role)).toEqual(['quality_reviewer', 'service_owner', 'supplier_maintainer']);
});

it('lets the only person approve their own fix and records it as self approved', async () => {
  const id = await propose(s.member_id);
  expect(await approve(s.member_id, id)).toEqual({ self_approved: true });
  expect((await db.owner.query<{ status: string }>('SELECT status FROM nazir.proposals WHERE id=$1', [id])).rows[0]!.status).toBe('approved');
});

it('brings the four eyes rule back when solo is off or a second person joins', async () => {
  await db.owner.query('UPDATE nazir.workspaces SET solo=false WHERE id=$1', [s.workspace_id]);
  await expect(approve(s.member_id, await propose(s.member_id))).rejects.toThrow('Another member');
  await db.owner.query('UPDATE nazir.workspaces SET solo=true WHERE id=$1', [s.workspace_id]);
  const second = await db.createMember(s.workspace_id, ['quality_reviewer', 'supplier_maintainer']);
  const own = await propose(s.member_id);
  await expect(approve(s.member_id, own)).rejects.toThrow('Another member');
  expect(await approve(second, own)).toEqual({ self_approved: false });
});
