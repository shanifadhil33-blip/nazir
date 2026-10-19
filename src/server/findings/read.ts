import 'server-only';
import { withMember } from '../db/context';
import { requireRole } from '../auth/guard';
import type { TransactionDriver } from '../db/driver';
export async function listFindings(driver:TransactionDriver,memberId:string,filters:{ runId?:string; conversationId?:string; status?:string; severity?:string }={}) {
  return withMember(driver,memberId,async (sql) => {
    await requireRole(sql,'finding.read');
    const rows=(await sql.query<{ finding:Record<string,unknown> }>('SELECT v AS finding FROM nazir.read_findings() v')).rows.map((r) => r.finding);
    return rows.filter((r) => (!filters.runId || r.run_id===filters.runId) && (!filters.conversationId || r.conversation_id===filters.conversationId) && (!filters.status || r.status===filters.status) && (!filters.severity || r.severity===filters.severity));
  });
}
export async function findingCard(driver:TransactionDriver,memberId:string,id:string) {
  const row=(await listFindings(driver,memberId)).find((r) => r.id===id);
  if(!row) return null;
  return { id:row.id,en:{ title:row.title,said:row.agent_said ?? null,reallyHappened:row.really_happened },ar:{ title:row.title_ar,said:row.agent_said ?? null,reallyHappened:row.really_happened_ar },severity:row.severity,ownerRole:row.owner_role };
}
