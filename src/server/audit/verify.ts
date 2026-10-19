import { createHash } from 'node:crypto';
import type { SqlConnection } from '../db/driver';

/** Text fields must come from readAuditChain to preserve PostgreSQL JSON and microseconds. */
export interface AuditRow extends Record<string, unknown> {
  workspace_id: string;
  seq: string;
  at: string;
  actor_type: string;
  actor_member_id: string | null;
  actor_name_at_event: string | null;
  actor_roles_at_event: string[];
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: string;
  prev_hash: string;
  hash: string;
}
/** Fixed field order and separator: docs/audit-chain.md. */
export function auditCanonical(row: AuditRow): string {
  return [row.workspace_id, row.seq, row.at, row.actor_type, row.actor_member_id ?? '',
    row.actor_name_at_event ?? '', row.actor_roles_at_event.join(','), row.action,
    row.target_type ?? '', row.target_id ?? '', row.payload, row.prev_hash].join('\u001f');
}
export type AuditVerification = { ok: true; count: number } | { ok: false; brokenAt: string; reason: 'hash_mismatch' | 'prev_link' | 'seq_gap' };
export function verifyAuditChain(rows: readonly AuditRow[]): AuditVerification {
  let seq = 1n;
  let previous = '0'.repeat(64);
  const workspace = rows[0]?.workspace_id;
  for (const row of rows) {
    if (row.seq !== seq.toString()) return { ok: false, brokenAt: row.seq, reason: 'seq_gap' };
    if (row.prev_hash !== previous || row.workspace_id !== workspace) return { ok: false, brokenAt: row.seq, reason: 'prev_link' };
    if (createHash('sha256').update(auditCanonical(row), 'utf8').digest('hex') !== row.hash) return { ok: false, brokenAt: row.seq, reason: 'hash_mismatch' };
    previous = row.hash;
    seq++;
  }
  return { ok: true, count: rows.length };
}
export async function readAuditChain(connection: SqlConnection, workspaceId: string): Promise<AuditRow[]> {
  const result = await connection.query<AuditRow>(`SELECT workspace_id::text,seq::text,
    to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
    actor_type,actor_member_id::text,actor_name_at_event,actor_roles_at_event,action,target_type,target_id,
    payload::text,prev_hash,hash FROM nazir.audit_events e WHERE workspace_id=$1 ORDER BY e.seq`, [workspaceId]);
  return result.rows;
}
