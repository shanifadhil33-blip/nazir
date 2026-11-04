import { expect, it } from 'vitest';
import { runLiveCheck } from '../../scripts/db-live-check.mjs';
import { loadTs } from '../../scripts/load-ts.mjs';
import { testDatabase } from '../helpers/pglite';

it('executes the live check locally and rolls every row back', async () => {
  const db = await testDatabase();
  try {
    await db.owner.query('CREATE ROLE nazir_login LOGIN NOINHERIT; GRANT nazir_app,nazir_worker TO nazir_login; SET ROLE nazir_login');
    const audit = await loadTs('../src/server/audit/verify.ts');
    const lines: string[] = [];
    const ok = await runLiveCheck(db.owner, audit, (line: string) => lines.push(line));
    expect(ok, lines.join("\n")).toBe(true);
    expect(lines).toHaveLength(12);
    expect(lines.every((line) => line.startsWith('PASS '))).toBe(true);
    await db.owner.query('RESET ROLE');
    for (const table of ['users', 'workspaces', 'members', 'rule_packs', 'audit_events']) {
      expect((await db.owner.query(`SELECT * FROM nazir.${table} WHERE NOT (${table === 'users' ? "email LIKE '%@demo.nazir.test'" : table === 'workspaces' ? "id='d0000000-0000-4000-8000-000000000100'" : table === 'members' ? "workspace_id='d0000000-0000-4000-8000-000000000100'" : 'false'})`)).rows, table).toHaveLength(0);
    }
  } finally { await db.close(); }
});
