import { Pool } from '@neondatabase/serverless';
import { loadTs } from './load-ts.mjs';

if (!process.env.DATABASE_URL_OWNER) throw new Error('DATABASE_URL_OWNER required');
const { migrate } = await loadTs('../src/server/db/migrate.ts');
const { poolDriver } = await loadTs('../src/server/db/driver.ts');
const pool = new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
try {
  const names = await migrate(poolDriver(pool));
  for (const name of names) console.log(name);
  console.log(`${names.length} migrations`);
} catch (error) {
  // Postgres messages name the failing statement, never the connection address; strip any URL anyway.
  console.error('Migration failed:', String(error?.message ?? error).replace(/postgres(ql)?:\/\/\S+/g, '[address]'));
  process.exitCode = 1;
} finally {
  await pool.end();
}
