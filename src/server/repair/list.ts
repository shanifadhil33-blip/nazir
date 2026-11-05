import 'server-only';
import { can, type Role } from '../auth/roles';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Forbidden } from '../http/errors';

export type ProposalListItem = {
  id: string; finding_id: string; status: 'proposed' | 'approved' | 'rejected' | 'withdrawn';
  title: string; title_ar: string; created_at: string; proposed_by_name: string | null; decided_at: string | null; decided_by_name: string | null;
};

/** Suggested fixes as every signed in role may see them: titles, people and times only. */
export async function listProposals(driver: TransactionDriver, memberId: string) {
  return withMember(driver, memberId, async (sql) => {
    const roles = (await sql.query<{ role: Role }>('SELECT role FROM nazir.member_roles WHERE member_id=nazir.current_member_id()')).rows.map((row) => row.role);
    if (!can(roles, 'run.read')) throw new Forbidden();
    const rows = (await sql.query<ProposalListItem>('SELECT * FROM nazir.list_proposals()')).rows;
    return { proposals: rows };
  });
}
