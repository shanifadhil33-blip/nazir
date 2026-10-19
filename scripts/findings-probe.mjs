import './runner-loader.mjs';
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
export async function main() {
  if(!process.env.DATABASE_URL || !process.env.WORKSPACE_ID) throw new Error('Read connection and workspace required');
  const [{ poolDriver },{ checkFindingComplete }]=await Promise.all([import('../src/server/db/driver.ts'),import('../src/server/findings/probe.ts')]);
  const pool=new Pool({ connectionString:process.env.DATABASE_URL });
  try {
    const findings=await poolDriver(pool).transaction(async (db) => { await db.query('SET TRANSACTION READ ONLY'); await db.query('SET LOCAL ROLE nazir_worker'); await db.query("SELECT set_config('app.workspace_id',$1,true)",[process.env.WORKSPACE_ID]); return (await db.query('SELECT * FROM nazir.findings WHERE workspace_id=$1',[process.env.WORKSPACE_ID])).rows; });
    let complete=0;
    for(const finding of findings) { const missing=checkFindingComplete(finding); if(!missing.length) complete++; else console.log(JSON.stringify({ id:finding.id,missing })); }
    console.log(`${complete} of ${findings.length} findings complete`);
    if(complete!==findings.length) process.exitCode=1;
  } finally { await pool.end(); }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Findings probe failed'); process.exitCode=1; });
