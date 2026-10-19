import './runner-loader.mjs';
import { Pool } from '@neondatabase/serverless';
import { poolDriver } from '../src/server/db/driver.ts';
import { createRunnerFixture } from '../src/server/runner/fixture.ts';
import { pathToFileURL } from 'node:url';
export async function main() {
  if (!process.env.DATABASE_URL_OWNER) throw new Error('Owner connection required');
  const pool=new Pool({ connectionString:process.env.DATABASE_URL_OWNER });
  try {
    const result=await poolDriver(pool).transaction((db) => createRunnerFixture(db));
    console.log(JSON.stringify(result));
    console.log('PASS runner fixture');
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('FAIL runner fixture'); process.exitCode=1; });
