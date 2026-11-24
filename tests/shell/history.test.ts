import { afterAll, beforeAll, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { testDatabase, seed, type TestDatabase } from '../helpers/pglite';
import { readHistory } from '../../src/server/shell/history';
import { readBell, markBellSeen } from '../../src/server/shell/bell';
import { randomUUID } from 'node:crypto';
let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); }, 60000);
afterAll(async () => { await db?.close(); });

it('shows paired fix-test start events once while preserving retries, legacy events and the audit log', async () => {
  const a = await seed(db, 'activity_paired');
  const b = await seed(db, 'activity_paired_other');
  const fix = randomUUID(), first = randomUUID(), retry = randomUUID(), legacy = randomUUID();
  const append = (member: string, action: string, run: string) => db.member(member, (sql) => sql.query("SELECT nazir.append_audit($1,'proposal',$2,$3::jsonb)", [action, fix, JSON.stringify({ run_id: run })]));
  for (const run of [first, retry]) { await append(a.member_id, 'proposal.rerun', run); await append(a.member_id, 'proposal.retest', run); }
  await append(a.member_id, 'proposal.rerun', legacy);
  await append(b.member_id, 'proposal.retest', legacy);
  const page = await readHistory(db.driver, a.member_id, 2);
  const older = await readHistory(db.driver, a.member_id, 2, page.cursor);
  expect([...page.items, ...older.items].map((item) => item.kind)).toEqual(['testStarted', 'testStarted', 'testStarted']);
  expect(new Set([...page.items, ...older.items].map((item) => item.id)).size).toBe(3);
  expect((await readHistory(db.driver, b.member_id)).items).toHaveLength(1);
  expect((await db.owner.query<{ n: number }>('SELECT count(*)::int AS n FROM nazir.audit_events WHERE workspace_id=$1 AND target_id=$2', [a.workspace_id, fix])).rows[0]!.n).toBe(5);
});

it('pages the audit log, keeps private payloads out, and isolates workspaces and per person seen state', async () => {
  const a = await seed(db, 'activity_a');
  const b = await seed(db, 'activity_b');
  const other = await db.createMember(a.workspace_id, ['service_owner'], 'Bilal');
  const append = async (action: string) => db.member(a.member_id, (sql) => sql.query("SELECT nazir.append_audit($1,'run',$2,$3::jsonb)", [action, a.ids.runs, JSON.stringify({ status: 'passed', secret: 'never_return_this' })]));
  await append('run_enqueued');
  for (let i = 0; i < 7; i++) await append('run_finished');
  const page = await readHistory(db.driver, a.member_id, 3);
  expect(page.items).toHaveLength(3); expect(page.cursor).toBe(page.items[2]!.id);
  const next = await readHistory(db.driver, a.member_id, 3, page.cursor);
  expect(next.items).toHaveLength(3); expect(next.items.map((i) => i.id)).not.toEqual(page.items.map((i) => i.id));
  expect(page.items.every((i) => i.href.includes(a.ids.reports!))).toBe(true);
  expect(JSON.stringify(page)).not.toContain('never_return_this');
  expect((await readHistory(db.driver, b.member_id)).items).toEqual([]);
  const bell = await readBell(db.driver, a.member_id);
  expect(bell.items).toHaveLength(5); expect(bell.unread).toBe(7);
  // A completion between reading and marking stays unread.
  await append('run_finished');
  await markBellSeen(db.driver, a.member_id, { through: bell.through });
  expect((await readBell(db.driver, a.member_id)).unread).toBe(1);
  expect((await readBell(db.driver, other)).unread).toBe(8);
  expect((await readBell(db.driver, b.member_id)).unread).toBe(0);
  // An older request arriving late cannot put the cursor back.
  await markBellSeen(db.driver, a.member_id, { through: '2020-01-01T00:00:00.000Z' });
  expect((await readBell(db.driver, a.member_id)).unread).toBe(1);
  await expect(db.member(other, (sql) => sql.query("UPDATE nazir.members SET seen_at=now() WHERE id=$1", [a.member_id]))).rejects.toThrow();
  const viewer = await db.createMember(a.workspace_id, ['viewer'], 'Omar');
  await expect(readHistory(db.driver, viewer)).rejects.toThrow();
  await expect(readBell(db.driver, viewer)).rejects.toThrow();
});
