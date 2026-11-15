import { afterAll, beforeAll, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { testDatabase, type TestDatabase } from '../helpers/pglite';
import { readMyLanguage, setMyLanguage } from '../../src/server/settings/language';

let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); }, 60000);
afterAll(async () => { await db?.close(); });

it('saves the language for one person only and changes nothing else', async () => {
  const { member_id: a, workspace_id: ws } = await db.bootstrap('lang_a');
  const b = await db.createMember(ws, ['service_owner'], 'Bilal');
  await db.owner.query("INSERT INTO nazir.agent_settings(workspace_id,name,language) VALUES($1,'Desk','en') ON CONFLICT(workspace_id) DO UPDATE SET name='Desk',language='en'", [ws]);
  const before = (await db.owner.query('SELECT name,language,focus_pack,instructions FROM nazir.agent_settings WHERE workspace_id=$1', [ws])).rows[0];
  expect(await readMyLanguage(db.driver, a)).toBeNull();
  await setMyLanguage(db.driver, a, 'ar');
  expect(await readMyLanguage(db.driver, a)).toBe('ar');
  expect(await readMyLanguage(db.driver, b)).toBeNull();
  expect((await db.owner.query('SELECT name,language,focus_pack,instructions FROM nazir.agent_settings WHERE workspace_id=$1', [ws])).rows[0]).toEqual(before);
  // Saving the same language twice writes one audit row.
  await setMyLanguage(db.driver, a, 'ar');
  expect((await db.owner.query("SELECT count(*)::int AS n FROM nazir.audit_events WHERE workspace_id=$1 AND action='member.language'", [ws])).rows[0]).toEqual({ n: 1 });
  await expect(setMyLanguage(db.driver, a, 'fr')).rejects.toThrow();
  // Nobody writes the column directly.
  await expect(db.member(b, (sql) => sql.query("UPDATE nazir.members SET language='ar' WHERE id=$1", [a]))).rejects.toThrow();
});
