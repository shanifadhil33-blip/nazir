import 'server-only';
import { z } from 'zod';
import type { TransactionDriver } from '../db/driver';
import { authCall } from './adapter';
import { TooMany } from '../http/errors';
import type { Membership } from './shape';

/** userId must come from the session, never the request body. */
export async function ensureHomeWorkspace(driver: TransactionDriver, userId: string): Promise<string> {
  return driver.transaction(async (sql) => {
    await sql.query('SET LOCAL ROLE nazir_auth');
    await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`home_workspace:${userId}`]);
    // Reuse this transaction so the lock covers the membership read and creation.
    const locked: TransactionDriver = { transaction: (work) => work(sql) };
    // auth_memberships returns only this user's active memberships.
    // Library and demo fixtures have their own synthetic members and confer no access.
    const memberships = await authCall<Omit<Membership, 'roleLabels'>>(locked, 'auth_memberships', [userId], userId);
    const home = memberships.find((membership) => membership.roles.includes('service_owner')) ?? memberships[0];
    if (home) return home.workspaceId;
    return (await createWorkspace(locked, userId, { name: 'My workspace' })).workspaceId;
  });
}
/** Abuse cap: one person may belong to at most this many workspaces. */
export const maxWorkspacesPerUser = 10;
const input = z.strictObject({ name: z.string().trim().min(1).max(200) });
/** userId must come from requireUser, never the request body. */
export async function createWorkspace(driver: TransactionDriver, userId: string, value: unknown) {
  const { name } = input.parse(value);
  const existing = await authCall(driver, 'auth_memberships', [userId], userId);
  if (existing.length >= maxWorkspacesPerUser) throw new TooMany('You can belong to at most 10 workspaces. Remove one to add another.');
  return (await authCall<{ workspaceId: string; memberId: string }>(driver, 'auth_create_workspace', [userId, name], userId))[0]!;
}
