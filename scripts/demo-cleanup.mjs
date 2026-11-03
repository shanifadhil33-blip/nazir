// Stale demo data cleanup (B6). Demo workspaces only. Default is a DRY RUN that prints counts.
//   node scripts/demo-cleanup.mjs                      dry run, all demo workspaces
//   node scripts/demo-cleanup.mjs --workspace <uuid>   dry run, one demo workspace
//   node scripts/demo-cleanup.mjs --apply              cancel stuck runs in one transaction
// Uses DATABASE_URL (the app login, worker role). Prints counts only, never row contents, ids or secrets.
// Plans and runs are never deleted: finished records are immutable and no role holds DELETE.
// --apply only cancels runs queued, running or planned for over a day, and their open conversations.
import { Pool } from '@neondatabase/serverless';
import { pathToFileURL } from 'node:url';
import { loadTs } from './load-ts.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv) {
  const options = { apply: false, workspace: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') options.apply = true;
    else if (argv[i] === '--workspace') {
      const value = argv[++i];
      if (!value || !uuid.test(value)) throw new Error('--workspace needs a workspace UUID');
      options.workspace = value.toLowerCase();
    } else throw new Error('Unknown option. Use --apply or --workspace <uuid>.');
  }
  return options;
}

/**
 * @param {any} driver
 * @param {any} stale
 * @param {{ apply?: boolean, workspace?: string | null, now?: Date }} [options]
 * @param {(line: string) => void} [log]
 * driver: { transaction(work) } as in src/server/db/driver.ts. Everything runs in one transaction.
 * A dry run sets the transaction read only first, so it cannot change anything.
 */
export async function runDemoCleanup(driver, stale, { apply = false, workspace = null, now = new Date() } = {}, log = console.log) {
  return driver.transaction(async (sql) => {
    if (!apply) await sql.query('SET TRANSACTION READ ONLY');
    await sql.query('SET LOCAL ROLE nazir_worker');
    // Only workspaces of kind demo are listed here, so a real workspace id is never touched, even if passed in.
    let ids = (await sql.query('SELECT id FROM nazir.demo_workspace_ids() ORDER BY id')).rows.map((row) => row.id);
    if (workspace) {
      if (!ids.includes(workspace)) throw new Error('That workspace is not a demo workspace.');
      ids = [workspace];
    }
    const total = { stuckRunIds: 0, cancelledRunIds: 0, cancelledPlanIds: 0, staleProposedPlanIds: 0, qaPlanIds: 0, qaRunIds: 0, cancelledNow: 0 };
    log(`${apply ? 'APPLY' : 'DRY RUN'}: ${ids.length} demo workspace(s)`);
    for (const id of ids) {
      await sql.query("SELECT set_config('app.workspace_id', $1, true)", [id]);
      const selection = stale.selectStale({ ...(await stale.loadStaleRows(sql)), now });
      const counts = stale.countStale(selection);
      const cancelledNow = apply ? await stale.cancelStuckRuns(sql, selection.stuckRunIds) : 0;
      for (const key of Object.keys(counts)) total[key] += counts[key];
      total.cancelledNow += cancelledNow;
      log(`${id.slice(0, 8)}: stuck runs ${counts.stuckRunIds}, cancelled runs ${counts.cancelledRunIds}, cancelled plans ${counts.cancelledPlanIds}, proposed over a day ${counts.staleProposedPlanIds}, QA plans ${counts.qaPlanIds}, QA runs ${counts.qaRunIds}${apply ? `, cancelled now ${cancelledNow}` : ''}`);
    }
    log(`TOTAL: stuck runs ${total.stuckRunIds}, cancelled runs ${total.cancelledRunIds}, cancelled plans ${total.cancelledPlanIds}, proposed over a day ${total.staleProposedPlanIds}, QA plans ${total.qaPlanIds}, QA runs ${total.qaRunIds}${apply ? `, cancelled now ${total.cancelledNow}` : ''}`);
    if (!apply) log('Dry run only. Nothing changed. Add --apply to cancel the stuck runs.');
    return total;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    const stale = await loadTs('../src/server/demo/stale.ts');
    const { poolDriver } = await loadTs('../src/server/db/driver.ts');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try { await runDemoCleanup(poolDriver(pool), stale, options); }
    finally { await pool.end(); }
  } catch (error) {
    // Strip any address from the message before printing.
    console.error('Cleanup failed:', String(error?.message ?? error).replace(/postgres(ql)?:\/\/\S+/g, '[address]'));
    process.exitCode = 1;
  }
}
