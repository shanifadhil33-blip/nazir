import 'server-only';
import type { AdapterUser } from 'next-auth/adapters';
import type { TransactionDriver } from '../db/driver';
import { authCall } from './adapter';
import { roleLabels, type Role } from './roles';
export type Membership = { workspaceId: string; workspaceName: string; kind: 'real' | 'demo'; memberId: string; roles: Role[]; roleLabels: { en: string[]; ar: string[] } };
export type UserSession = { user: { id: string; name: string | null; email: string; image: string | null }; memberships: Membership[] };
export async function sessionShape(driver: TransactionDriver, user: AdapterUser): Promise<UserSession> {
  const rows = await authCall<Omit<Membership, 'roleLabels'>>(driver, 'auth_memberships', [user.id], user.id);
  return { user: { id: user.id, name: user.name ?? null, email: user.email, image: user.image ?? null }, memberships: rows.map((row) => ({ ...row, roleLabels: { en: row.roles.map((r) => roleLabels[r].en), ar: row.roles.map((r) => roleLabels[r].ar) } })) };
}
