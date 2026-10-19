import 'server-only';
import { z } from 'zod';
import type { TransactionDriver } from '../db/driver';
import { authCall } from './adapter';
import { TooMany } from '../http/errors';
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
