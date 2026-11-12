import 'server-only';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { requireRole } from '../auth/guard';
import { NotFound } from '../http/errors';

export type PendingRun = { run_id: string; workspace_id: string; started_by: string };

/** Every worker transaction revalidates the trusted starter before existing worker code sets its role.
 * The existing scoped claim and workspace RLS remain in force. Model calls happen outside transactions. */
export function starterDriver(driver: TransactionDriver, run: PendingRun): TransactionDriver {
  return {
    transaction: (work) => withMember(driver, run.started_by, async (sql) => {
      await requireRole(sql, 'plan.approve');
      const row = (await sql.query('SELECT id FROM nazir.runs WHERE id=$1 AND workspace_id=$2 AND workspace_id=nazir.current_workspace_id()', [run.run_id, run.workspace_id])).rows[0];
      if (!row) throw new NotFound();
      return work(sql);
    }),
  };
}
