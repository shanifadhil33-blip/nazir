import 'server-only';
import { authCall } from '../auth/adapter';
import { withMember } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { Coded, Forbidden, errorLines } from '../http/errors';

/** Abuse cap: one signed in person may start at most this many runs a day, across all their workspaces. The daily model call cap still applies. */
export const maxRunsPerUserPerDay = 10;

export type RunStarter = { memberId: string; userId: string; members: { workspaceId: string; memberId: string }[] };

/** The person behind a member, with every active membership they hold. memberId must come from the session. */
export async function runStarter(driver: TransactionDriver, memberId: string): Promise<RunStarter> {
  const found = await withMember(driver, memberId, async (sql) => (await sql.query<{ user_id: string; workspace_id: string }>('SELECT user_id,workspace_id FROM nazir.members WHERE id=nazir.current_member_id()')).rows[0]);
  if (!found) throw new Forbidden();
  const rows = await authCall<{ workspaceId: string; memberId: string }>(driver, 'auth_memberships', [found.user_id], found.user_id);
  const members = rows.map((r) => ({ workspaceId: String(r.workspaceId), memberId: String(r.memberId) }));
  if (!members.some((m) => m.memberId === memberId)) members.push({ workspaceId: found.workspace_id, memberId });
  return { memberId, userId: found.user_id, members };
}

/**
 * Counts the runs this person started today (UTC, like the model call cap) and refuses one more past the cap.
 * Runs inside the worker enqueue transaction. A per person lock serializes concurrent starts, and each
 * workspace is read under its own context, which is restored afterwards.
 */
export async function assertRunCap(db: SqlConnection, starter: RunStarter, cap = maxRunsPerUserPerDay) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`run_cap:${starter.userId}`]);
  const previous = (await db.query<{ w: string | null }>("SELECT current_setting('app.workspace_id',true) AS w")).rows[0]?.w ?? '';
  let used = 0;
  for (const m of starter.members) {
    await db.query("SELECT set_config('app.workspace_id',$1,true)", [m.workspaceId]);
    used += Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM nazir.audit_events WHERE action='run_enqueued' AND payload->>'started_by'=$1
      AND at>=(date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`, [m.memberId])).rows[0]!.n);
  }
  await db.query("SELECT set_config('app.workspace_id',$1,true)", [previous]);
  if (used >= cap) throw new Coded(429, 'daily_run_cap', errorLines.daily_run_cap.en);
  return used;
}
