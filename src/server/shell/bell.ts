import 'server-only';
import { z } from 'zod';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { requireRole } from '../auth/guard';
import { activityPage, completionActions, type ActivityItem } from './history';

export type BellData = { items: ActivityItem[]; unread: number; through: string };
/** The same completed events as History. Count all unread events, display the latest five. */
export async function readBell(driver: TransactionDriver, memberId: string): Promise<BellData> {
  return withMember(driver, memberId, async (sql) => {
    await requireRole(sql, 'audit.read');
    // Fix the cutoff before reading so a completion arriving during these reads stays unread.
    const through = (await sql.query<{ at: string }>('SELECT clock_timestamp()::text AS at')).rows[0]!.at;
    const page = await activityPage(sql, 5, null, true);
    const unread = (await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM nazir.audit_events a WHERE action=ANY($1::text[])
      AND at>coalesce(nazir.my_seen_at(),'-infinity'::timestamptz) AND at<=$2::timestamptz
      AND (target_type<>'run' OR EXISTS(SELECT 1 FROM nazir.runs WHERE id::text=a.target_id))`, [completionActions, through])).rows[0]!.n;
    return { items: page.items, unread, through: new Date(through).toISOString() };
  });
}
export async function markBellSeen(driver: TransactionDriver, memberId: string, value: unknown) {
  const { through } = z.object({ through: z.iso.datetime() }).strict().parse(value);
  await withMember(driver, memberId, async (sql) => { await requireRole(sql, 'audit.read'); await sql.query('SELECT nazir.mark_seen($1::timestamptz)', [through]); });
  return { unread: 0 };
}
