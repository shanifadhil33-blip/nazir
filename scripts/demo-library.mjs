// Installs the Government tests, rules and planted fault versions into the demo workspace, so a Quick check can start there
// and the demo history points at real tests. Needs DATABASE_URL_OWNER and DATABASE_URL. Safe to run twice. Prints counts only.
import './runner-loader.mjs';
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
export async function main() {
  if (!process.env.DATABASE_URL_OWNER || !process.env.DATABASE_URL) throw new Error('Owner and app connections required');
  const [{ poolDriver }, { installDemoLibrary }] = await Promise.all([import('../src/server/db/driver.ts'), import('../src/server/demo/library.ts')]);
  const owner = new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
  const app = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log(JSON.stringify(await installDemoLibrary(poolDriver(owner), poolDriver(app))));
    console.log('PASS demo library');
  } finally { await owner.end(); await app.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error('FAIL demo library', String(error?.message ?? '').replace(/postgres(ql)?:\/\/\S+/g, '[address]').slice(0, 200)); process.exitCode = 1; });
