import './runner-loader.mjs';
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
// The loader hooks must be registered before any TypeScript module is resolved, so TS modules load dynamically.
export async function main() {
  if (!process.env.DATABASE_URL_OWNER || !process.env.DATABASE_URL) throw new Error('Owner and app connections required');
  const [{ poolDriver }, { createRunnerFixture }] = await Promise.all([import('../src/server/db/driver.ts'), import('../src/server/runner/fixture.ts')]);
  // Managed Postgres owners are not members of nazir_worker, so the workspace is bootstrapped over the app login first (idempotent).
  const app = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await poolDriver(app).transaction(async (db) => {
      await db.query('SET LOCAL ROLE nazir_worker');
      const found = (await db.query('SELECT nazir.runner_fixture_workspace() AS id')).rows[0]?.id;
      if (!found) await db.query("SELECT * FROM nazir.bootstrap_workspace($1,'Omar Mansoor',$2,'demo')", ['runner_nazirrunnerfixture@example.test', 'Nazir runner fixture']);
    });
  } finally { await app.end(); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
  try {
    const result = await poolDriver(pool).transaction((db) => createRunnerFixture(db));
    console.log(JSON.stringify({ workspaceId: result.workspaceId, planId: result.planId, versions: result.versions.length, scenarios: result.scenarios.length }));
    console.log('PASS runner fixture');
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error('FAIL runner fixture', String(error?.message ?? '').replace(/postgres(ql)?:\/\/\S+/g, '[address]').slice(0, 200)); process.exitCode = 1; });
