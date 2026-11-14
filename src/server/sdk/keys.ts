import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { TransactionDriver } from '../db/driver';
import { withMember } from '../db/context';
import { Forbidden } from '../http/errors';
import { workspacePublicId } from './signing';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function base62(bytes: Buffer) {
  let out = '';
  for (const byte of bytes) out += BASE62[byte % 62];
  return out;
}
export const keyHash = (key: string) => createHash('sha256').update(key).digest('hex');
export const keyPattern = /^nzk_([0-9a-f]{32})_([0-9A-Za-z]{40})$/;

export type SdkStatus = { key_last4: string | null; key_created_at: string | null; key_used_at: string | null; sdk_seen_at: string | null; sdk_version: string | null; tools: number; mcp_servers: number };

async function member<T>(driver: TransactionDriver, memberId: string, work: Parameters<typeof withMember<T>>[2]) {
  try { return await withMember(driver, memberId, work); }
  catch (error) { if (/cannot do this|demo_connection/.test(String((error as Error)?.message))) throw new Forbidden(); throw error; }
}
export function readSdkStatus(driver: TransactionDriver, memberId: string): Promise<SdkStatus> {
  return member(driver, memberId, async (sql) => (await sql.query<{ s: SdkStatus }>('SELECT nazir.read_sdk_status() AS s')).rows[0]!.s);
}
/** Shown once. Only its hash and last 4 characters are stored. Making a new key turns off the old one. */
export async function makeSdkKey(driver: TransactionDriver, memberId: string): Promise<{ key: string; last4: string }> {
  return member(driver, memberId, async (sql) => {
    const workspace = (await sql.query<{ id: string }>('SELECT nazir.current_workspace_id() AS id')).rows[0]!.id;
    const key = `nzk_${workspacePublicId(workspace)}_${base62(randomBytes(40))}`;
    const last4 = key.slice(-4);
    await sql.query('SELECT nazir.issue_sdk_key($1,$2)', [keyHash(key), last4]);
    return { key, last4 };
  });
}
export function turnOffSdkKey(driver: TransactionDriver, memberId: string) {
  return member(driver, memberId, async (sql) => ({ turned_off: (await sql.query<{ ok: boolean }>('SELECT nazir.revoke_sdk_key() AS ok')).rows[0]!.ok }));
}
export function deleteTraces(driver: TransactionDriver, memberId: string) {
  return member(driver, memberId, async (sql) => ({ deleted: (await sql.query<{ n: number }>('SELECT nazir.delete_traces() AS n')).rows[0]!.n }));
}
