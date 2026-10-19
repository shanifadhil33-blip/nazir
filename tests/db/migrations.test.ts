import { afterAll, beforeAll, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { migrate } from '../../src/server/db/migrate';
import { testDatabase, type TestDatabase } from '../helpers/pglite';

let db: TestDatabase;
beforeAll(async () => { db = await testDatabase(); });
afterAll(async () => { await db?.close(); });
it('applies ordered files once and then does nothing', async () => {
  expect(db.migrations).toEqual(['0001_core.sql', '0002_rls.sql', '0003_audit_chain.sql', '0004_roles.sql', '0005_sandbox.sql', '0006_inspection.sql', '0007_ai_chain.sql', '0008_runner.sql', '0009_auth.sql', '0010_library.sql', '0011_fixtures.sql', '0012_findings.sql', '0013_compare.sql', '0014_repair.sql', '0015_memory.sql']);
  expect(await migrate(db.driver)).toEqual([]);
  expect((await db.owner.query('SELECT * FROM public.nazir_migrations WHERE applied_at IS NOT NULL')).rows).toHaveLength(15);
});
it('refuses a changed applied file before applying anything else', async () => {
  const root = await mkdtemp(join(process.cwd(), 'tests/db/.migration-check-'));
  try {
    await cp(join(process.cwd(), 'db/migrations'), root, { recursive: true });
    const path = join(root, '0001_core.sql');
    await writeFile(path, (await readFile(path, 'utf8')) + '\n-- changed\n');
    await writeFile(join(root, '0005_pending.sql'), 'CREATE TABLE public.must_not_exist(id int);');
    await expect(migrate(db.driver, root)).rejects.toThrow('Applied migration changed');
    expect((await db.owner.query("SELECT to_regclass('public.must_not_exist') AS name")).rows).toEqual([{ name: null }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('commits each file separately and rolls back a failing file with its ledger entry', async () => {
  const root = await mkdtemp(join(process.cwd(), 'tests/db/.migration-check-'));
  try {
    await cp(join(process.cwd(), 'db/migrations'), root, { recursive: true });
    await writeFile(join(root, '0005_good.sql'), 'CREATE TABLE public.migration_good(id int);');
    await writeFile(join(root, '0006_bad.sql'), 'CREATE TABLE public.migration_bad(id int); SELECT missing_function();');
    await expect(migrate(db.driver, root)).rejects.toThrow(/missing_function/);
    expect((await db.owner.query("SELECT to_regclass('public.migration_good')::text AS good,to_regclass('public.migration_bad')::text AS bad")).rows).toEqual([{ good: 'migration_good', bad: null }]);
    expect((await db.owner.query("SELECT name FROM public.nazir_migrations WHERE name IN ('0005_good.sql','0006_bad.sql')")).rows).toEqual([{ name: '0005_good.sql' }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
