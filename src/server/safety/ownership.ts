import 'server-only';
import { createHmac } from 'node:crypto';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';
import { Coded } from '../http/errors';
import { guardedText, type Transport } from '../connect/http';
import { type ExternalView } from '../settings/external-agent';

export const freshSdk = (connection: ExternalView) => connection.connection_kind === 'sdk' && Boolean(connection.sdk_seen_at && new Date(connection.sdk_seen_at).getTime() > Date.now() - 86_400_000);
export type OwnershipProof = { url: string; token: string };
/** Public file content, purpose separated from authentication and bound to this exact connection. */
export function domainProof(workspaceId: string, connection: ExternalView, secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? ''): OwnershipProof {
  if (secret.length < 16 || !connection.endpoint || !connection.revision) throw new Coded(503, 'failed', 'Try again later.');
  const origin = new URL(connection.endpoint).origin;
  const token = createHmac('sha256', secret).update(JSON.stringify(['nazir-domain-proof-v1', workspaceId, origin, connection.revision])).digest('hex');
  return { url: `${origin}/.well-known/nazir-verify.txt`, token };
}
export async function safetyOwnership(driver: TransactionDriver, memberId: string, connection: ExternalView | null) {
  if (!connection?.ready) return { confirmed: false, proof: null };
  return withMember(driver, memberId, async (sql) => {
    const state = (await sql.query<{ workspace: string; confirmed: boolean }>('SELECT nazir.current_workspace_id() AS workspace,nazir.safety_is_confirmed($1) AS confirmed', [connection.revision ?? null])).rows[0]!;
    // Only the person able to configure this connection receives its public verification file.
    return { confirmed: state.confirmed, proof: !state.confirmed && !freshSdk(connection) && connection.endpoint && connection.revision ? domainProof(state.workspace, connection) : null };
  });
}
/** No credentials, no redirects and at most 1 KB from the connected HTTPS origin. */
export async function verifyDomainProof(proof: OwnershipProof, options: Transport = {}) {
  let body: string;
  try { body = await guardedText(proof.url, { method: 'GET', headers: { accept: 'text/plain' } }, options, 1024); }
  catch { throw new Coded(409, 'safety_proof_needed', 'Add the verification file to your agent website, then try again.'); }
  if (body.trim() !== proof.token) throw new Coded(409, 'safety_proof_needed', 'Add the verification file to your agent website, then try again.');
}
