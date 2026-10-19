import 'server-only';
import { isIP } from 'node:net';
import { z } from 'zod';
import { requireRole } from '../auth/guard';
import type { Action } from '../auth/roles';
import { withMember } from '../db/context';
import type { SqlConnection, TransactionDriver } from '../db/driver';
import { Forbidden, NotFound } from '../http/errors';

const uuid = z.uuid();
const json = z.json();
const reason = z.string().trim().min(3).max(10000);
const decisionInput = z.object({ id: uuid, decision: z.enum(['approve', 'reject']), reason, evidence_opened: z.boolean() });
const draftInput = z.object({ rule_pack_id: uuid, version: z.number().int().positive(), content: json });
const approveInput = z.object({ id: uuid, reason, evidence_opened: z.boolean() });
const repairInput = z.object({ finding_id: uuid, evidence: z.string().trim().min(3), patch: json });
export function isAllowedHost(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash
      && host.length <= 253 && host.split('.').every((label) => label.length <= 63) && !isIP(host) && !host.includes(':') && !host.startsWith('[') && host.includes('.')
      && !/(^|\.)(localhost|internal|local|localdomain|home|lan|test|invalid)$/.test(host)
      && /^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(host) && !host.split('.').some((label) => !label || label.startsWith('-') || label.endsWith('-'));
  } catch { return false; }
}
const adapterInput = z.object({
  agent_id: uuid, kind: z.enum(['http', 'built_in']),
  base_url: z.string().nullable(), allowed_hosts: z.array(z.string().refine(isAllowedHost, 'Use a public HTTPS host.')), tool_manifest: json,
}).superRefine((input, ctx) => {
  if (input.kind === 'http') {
    try {
      const url = new URL(input.base_url ?? '');
      if (url.protocol !== 'https:' || url.username || url.password || !input.allowed_hosts.some((host) => new URL(host).origin === url.origin)) throw new Error();
    } catch { ctx.addIssue({ code: 'custom', message: 'Use an allowed HTTPS address.' }); }
  }
});

async function record(connection: SqlConnection, action: Action, target: string, id: string) {
  await connection.query('SELECT nazir.append_audit($1,$2,$3,$4::jsonb)', [action, target, id, '{}']);
}
async function inMember<T>(driver: TransactionDriver, memberId: string, action: Action, work: (sql: SqlConnection) => Promise<T>) {
  return withMember(driver, memberId, async (sql) => { await requireRole(sql, action); return work(sql); });
}
// Table names come only from these fixed internal call sites. Record ids are always bound.
async function existing(sql: SqlConnection, table: string, id: string, lock = false) {
  const row = (await sql.query(`SELECT * FROM nazir.${table} WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!row) throw new NotFound();
  return row;
}
async function approval(sql: SqlConnection, subject: string, input: z.infer<typeof decisionInput>) {
  return (await sql.query<{ id: string }>(`INSERT INTO nazir.approvals(workspace_id,subject_type,subject_id,decision,reason,evidence_opened,decided_by,decided_by_name_at_event,decided_by_roles_at_event)
    VALUES(nazir.current_workspace_id(),$1,$2,$3,$4,$5,nazir.current_member_id(),'','{}') RETURNING id`,
  [subject, input.id, input.decision, input.reason, input.evidence_opened])).rows[0]!;
}
async function otherAuthor(sql: SqlConnection, author: unknown) {
  const member = (await sql.query<{ id: string }>('SELECT nazir.current_member_id() AS id')).rows[0]!;
  if (author === member.id) throw new Forbidden();
}
export async function draftRulePackVersion(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = draftInput.parse(value);
  return inMember(driver, memberId, 'rule_pack.draft', async (sql) => {
    await existing(sql, 'rule_packs', input.rule_pack_id);
    const row = (await sql.query<{ id: string; status: string }>(`INSERT INTO nazir.rule_pack_versions(workspace_id,rule_pack_id,version,content)
      VALUES(nazir.current_workspace_id(),$1,$2,$3::jsonb) RETURNING id,status`, [input.rule_pack_id, input.version, JSON.stringify(input.content)])).rows[0]!;
    await record(sql, 'rule_pack.draft', 'rule_pack_version', row.id); return row;
  });
}
export async function approveRulePackVersion(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = approveInput.parse(value);
  return inMember(driver, memberId, 'rule_pack.approve', async (sql) => {
    const row = await existing(sql, 'rule_pack_versions', input.id, true);
    await otherAuthor(sql, row.created_by);
    if (!['draft', 'submitted'].includes(String(row.status))) throw new Forbidden();
    const decision = await approval(sql, 'rule_pack_version', { ...input, decision: 'approve' });
    await sql.query("UPDATE nazir.rule_pack_versions SET status='approved',approved_by=nazir.current_member_id(),approved_at=now() WHERE id=$1", [input.id]);
    await record(sql, 'rule_pack.approve', 'rule_pack_version', input.id); return { id: input.id, status: 'approved', approval_id: decision.id };
  });
}
export async function registerAdapter(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = adapterInput.parse(value);
  return inMember(driver, memberId, 'adapter.write', async (sql) => {
    await existing(sql, 'agents', input.agent_id);
    const row = (await sql.query<{ id: string; status: string }>(`INSERT INTO nazir.adapters(workspace_id,agent_id,kind,base_url,allowed_hosts,tool_manifest)
      VALUES(nazir.current_workspace_id(),$1,$2,$3,$4,$5::jsonb) RETURNING id,status`, [input.agent_id, input.kind, input.base_url, input.allowed_hosts, JSON.stringify(input.tool_manifest)])).rows[0]!;
    await record(sql, 'adapter.write', 'adapter', row.id); return row;
  });
}
export async function proposeRepair(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = repairInput.parse(value);
  return inMember(driver, memberId, 'proposal.create', async (sql) => {
    await existing(sql, 'findings', input.finding_id);
    const row = (await sql.query<{ id: string; status: string }>(`INSERT INTO nazir.proposals(workspace_id,finding_id,proposed_by_type,proposed_by,evidence,patch)
      VALUES(nazir.current_workspace_id(),$1,'member',nazir.current_member_id(),$2,$3::jsonb) RETURNING id,status`, [input.finding_id, input.evidence, JSON.stringify(input.patch)])).rows[0]!;
    await record(sql, 'proposal.create', 'proposal', row.id); return row;
  });
}
export async function decideProposal(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = decisionInput.parse(value);
  return inMember(driver, memberId, 'proposal.decide', async (sql) => {
    const row = await existing(sql, 'proposals', input.id, true);
    await otherAuthor(sql, row.proposed_by);
    if (row.status !== 'proposed') throw new Forbidden();
    const decision = await approval(sql, 'proposal', input);
    const status = input.decision === 'approve' ? 'approved' : 'rejected';
    await sql.query('UPDATE nazir.proposals SET status=$1 WHERE id=$2', [status, input.id]);
    await record(sql, 'proposal.decide', 'proposal', input.id); return { id: input.id, status, approval_id: decision.id };
  });
}
export async function overrideFinding(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = approveInput.parse(value);
  return inMember(driver, memberId, 'finding.override', async (sql) => {
    await existing(sql, 'findings', input.id, true);
    const decision = await approval(sql, 'finding_override', { ...input, decision: 'approve' });
    await sql.query("UPDATE nazir.findings SET status='overridden' WHERE id=$1", [input.id]);
    await record(sql, 'finding.override', 'finding', input.id); return { id: input.id, status: 'overridden', approval_id: decision.id };
  });
}
export async function recordReleaseDecision(driver: TransactionDriver, memberId: string, value: unknown) {
  const input = decisionInput.parse(value);
  return inMember(driver, memberId, 'release.decide', async (sql) => {
    await existing(sql, 'runs', input.id);
    const decision = await approval(sql, 'release', input);
    await record(sql, 'release.decide', 'release', input.id); return { id: decision.id, decision: input.decision };
  });
}
