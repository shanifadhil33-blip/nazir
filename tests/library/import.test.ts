import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { families, type LibraryFamily } from '../../src/server/library/schema';
import { importLibrary, approveScenario, regressionSuite, readScenarios, markUsedForFix } from '../../src/server/library/import';
import { Forbidden, NotFound } from '../../src/server/http/errors';
let db: TestDatabase;
let files: LibraryFamily[];
let workspace: { member_id: string; workspace_id: string };
let reviewer: string;
let ids: string[];
beforeAll(async () => {
  db = await testDatabase(); workspace = await db.bootstrap('Library');
  reviewer = await db.createMember(workspace.workspace_id, ['quality_reviewer'], 'Omar Haddad');
  files = await Promise.all(families.map(async (f) => JSON.parse(await readFile(`src/server/library/scenarios/${f}.json`, 'utf8'))));
});
afterAll(async () => { await db?.close(); });
it('imports all meanings and twins as drafts with an audit event and reuses unchanged versions', async () => {
  ids = await importLibrary(db.driver, workspace.member_id, files);
  expect(ids).toHaveLength(58);
  expect((await db.owner.query('SELECT * FROM nazir.scenario_meanings')).rows).toHaveLength(29);
  const rows = (await db.owner.query('SELECT * FROM nazir.scenarios')).rows;
  expect(rows.every((s) => s.status === 'draft' && s.created_by === workspace.member_id && s.approved_by === null)).toBe(true);
  expect(await importLibrary(db.driver, workspace.member_id, files)).toEqual(ids);
  expect(await regressionSuite(db.driver, reviewer)).toEqual([]);
  expect((await db.owner.query("SELECT * FROM nazir.audit_events WHERE action='library.import'")).rows).toHaveLength(2);
});
it('requires a different human approver and freezes scenario and meaning content', async () => {
  await expect(approveScenario(db.driver, workspace.member_id, ids[0]!)).rejects.toBeInstanceOf(Forbidden);
  const approved = await approveScenario(db.driver, reviewer, ids[0]!);
  expect(approved).toMatchObject({ status: 'approved', approved_by: reviewer, approved_at: expect.anything() });
  expect((await regressionSuite(db.driver, reviewer)).map((s) => s.id)).toEqual([ids[0]]);
  for (const change of ["expected_state='{}'", "resident_turns='[]'", "checks='{}'", "source='generated'", "status='draft'"]) await expect(db.member(reviewer, (sql) => sql.query(`UPDATE nazir.scenarios SET ${change} WHERE id=$1`, [ids[0]]))).rejects.toThrow('Approved content is immutable');
  await expect(db.member(reviewer, (sql) => sql.query("UPDATE nazir.scenario_meanings SET canonical='{}' WHERE id=$1", [approved.meaning_id]))).rejects.toThrow('Approved meaning is immutable');
});
it('creates a new draft version for a content change without changing approved content', async () => {
  const changed = structuredClone(files);
  changed[0]!.meanings[0]!.scenarios[0]!.resident_turns.push('Please explain the required details.');
  const newIds = await importLibrary(db.driver, workspace.member_id, changed);
  expect(newIds[0]).not.toBe(ids[0]);
  expect((await db.owner.query('SELECT status,version FROM nazir.scenarios WHERE id=$1', [newIds[0]])).rows).toEqual([{ status: 'draft', version: 2 }]);
  expect((await db.owner.query('SELECT status,version FROM nazir.scenarios WHERE id=$1', [ids[0]])).rows).toEqual([{ status: 'approved', version: 1 }]);
});
it('keeps generated content out of regression until a different human approves', async () => {
  const generated = await importLibrary(db.driver, workspace.member_id, files, 'generated');
  expect((await regressionSuite(db.driver, reviewer)).some((s) => s.source === 'generated')).toBe(false);
  expect((await db.owner.query("SELECT status FROM nazir.scenarios WHERE source='generated'")).rows.every((s) => s.status === 'draft')).toBe(true);
  await approveScenario(db.driver, reviewer, generated[2]!);
  expect((await regressionSuite(db.driver, reviewer)).filter((s) => s.source === 'generated')).toHaveLength(1);
});
it('marks both twins and later versions as seen after either twin is used for a fix', async () => {
  const hidden = await readScenarios(db.driver, reviewer, 'hidden');
  const item = hidden[0]!;
  await markUsedForFix(db.driver, reviewer, String(item.id));
  const rows = await readScenarios(db.driver, reviewer, 'hidden');
  const familyRows = rows.filter((s) => s.meaning_id === item.meaning_id);
  expect(familyRows.length).toBeGreaterThanOrEqual(2);
  expect(familyRows.every((s) => s.unseen === false)).toBe(true);
  expect(rows.some((s) => s.unseen === true)).toBe(true);
});
it.each(['supplier_maintainer', 'viewer'] as const)('refuses hidden reads at the server and database as %s', async (role) => {
  const member = await db.createMember(workspace.workspace_id, [role]);
  await expect(readScenarios(db.driver, member, 'hidden')).rejects.toBeInstanceOf(Forbidden);
  await expect(importLibrary(db.driver, member, files)).rejects.toBeInstanceOf(Forbidden);
  await expect(approveScenario(db.driver, member, ids[1]!)).rejects.toBeInstanceOf(Forbidden);
  expect((await db.member(member, (sql) => sql.query("SELECT * FROM nazir.scenarios WHERE split='hidden'"))).rows).toHaveLength(0);
  const hiddenMeanings = (await db.owner.query<{ meaning_id: string }>("SELECT DISTINCT meaning_id FROM nazir.scenarios WHERE split='hidden'")).rows.map((s) => s.meaning_id);
  expect((await db.member(member, (sql) => sql.query('SELECT * FROM nazir.scenario_meanings WHERE id=ANY($1::uuid[])', [hiddenMeanings]))).rows).toHaveLength(0);
});
it('refuses cross workspace approvals and exposure markers', async () => {
  const other = await db.bootstrap('Other library');
  await expect(approveScenario(db.driver, other.member_id, ids[1]!)).rejects.toBeInstanceOf(NotFound);
  await expect(markUsedForFix(db.driver, other.member_id, ids[1]!)).rejects.toBeInstanceOf(NotFound);
});

it('accepts the hashed loader output for import', async () => {
  const { loadLibrary } = await import('../../src/server/library/load');
  expect(await importLibrary(db.driver, workspace.member_id, await loadLibrary())).toHaveLength(58);
});
it('carries fix exposure across new canonical meaning versions', async () => {
  const changed = structuredClone(files);
  const family = changed.find((f) => f.family === 'broad_case_export')!;
  const before = (await readScenarios(db.driver, reviewer, 'hidden')).find((s) => s.stable_key === family.meanings[0]!.scenarios[0]!.stable_key)!;
  await markUsedForFix(db.driver, reviewer, String(before.id));
  family.meanings[0]!.scenarios[0]!.resident_turns.push('Give only my case status.');
  await importLibrary(db.driver, workspace.member_id, changed);
  const after = (await readScenarios(db.driver, reviewer, 'hidden')).filter((s) => String(s.stable_key).startsWith('broad_case_export_normal'));
  expect(after.length).toBeGreaterThanOrEqual(4);
  expect(after.every((s) => s.unseen === false)).toBe(true);
});
