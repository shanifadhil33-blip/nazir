import './runner-loader.mjs';
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
export async function main() {
  if(!process.env.DATABASE_URL_OWNER || !process.env.DATABASE_URL) throw new Error('Owner connection required');
  const [{ poolDriver },{ createLibraryFixtureStaged }]=await Promise.all([import('../src/server/db/driver.ts'),import('../src/server/runner/library-fixture.ts')]);
  const app=new Pool({connectionString:process.env.DATABASE_URL});
  try { await poolDriver(app).transaction(async db=>{ await db.query('SET LOCAL ROLE nazir_worker'); const found=(await db.query('SELECT nazir.runner_library_fixture_workspace() AS id')).rows[0]?.id; if(!found) await db.query("SELECT * FROM nazir.bootstrap_workspace('runner_nazirlibraryfixture@example.test','Omar Mansoor','Nazir library fixture','demo')"); }); } finally { await app.end(); }
  const pool=new Pool({ connectionString:process.env.DATABASE_URL_OWNER }),member=new Pool({ connectionString:process.env.DATABASE_URL });
  try { console.log(JSON.stringify(await createLibraryFixtureStaged(poolDriver(pool),poolDriver(member)))); }
  finally { await pool.end(); await member.end(); }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error('Library fixture failed',String(error?.message??'').replace(/postgres(ql)?:\/\/\S+/g,'[address]').slice(0,200)); process.exitCode=1; });
