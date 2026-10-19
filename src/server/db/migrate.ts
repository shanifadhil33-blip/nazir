import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TransactionDriver } from './driver';

/** Owner only. Each file and its checksum are committed together. */
export async function migrate(driver: TransactionDriver, root = join(process.cwd(), 'db/migrations')): Promise<string[]> {
  const names = (await readdir(root)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const files = await Promise.all(names.map(async (name) => {
    const source = await readFile(join(root, name), 'utf8');
    return { name, source, checksum: createHash('sha256').update(source).digest('hex') };
  }));
  await driver.transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(710192026)');
    await db.query('CREATE TABLE IF NOT EXISTS public.nazir_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    await db.query('REVOKE ALL ON public.nazir_migrations FROM PUBLIC');
    const applied = await db.query<{ name: string; checksum: string }>('SELECT name,checksum FROM public.nazir_migrations');
    for (const row of applied.rows) {
      if (files.find((file) => file.name === row.name)?.checksum !== row.checksum) throw new Error(`Applied migration changed or missing: ${row.name}`);
    }
  });
  const added: string[] = [];
  for (const file of files) {
    await driver.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(710192026)');
      const applied = await db.query<{ checksum: string }>('SELECT checksum FROM public.nazir_migrations WHERE name=$1', [file.name]);
      if (applied.rows.length) {
        if (applied.rows[0]?.checksum !== file.checksum) throw new Error(`Applied migration changed: ${file.name}`);
        return;
      }
      // Simple query protocol supports entire SQL files, including function bodies.
      await db.query(file.source);
      await db.query('INSERT INTO public.nazir_migrations(name,checksum) VALUES($1,$2)', [file.name, file.checksum]);
      added.push(file.name);
    });
  }
  return added;
}
