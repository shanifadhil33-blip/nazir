import 'server-only';
import { auth } from '../../auth';
import { Forbidden, Unauthorized } from '../http/errors';
import type { UserSession } from './shape';
export async function requireUser(): Promise<UserSession> {
  const session = await auth();
  if (!session?.user?.id) throw new Unauthorized();
  return { user: { id: session.user.id, name: session.user.name ?? null, email: session.user.email!, image: session.user.image ?? null }, memberships: session.memberships };
}
export async function requireMember(workspaceId: string) {
  const session = await requireUser();
  const member = session.memberships.find((m) => m.workspaceId === workspaceId);
  if (!member) throw new Forbidden();
  return { memberId: member.memberId, roles: member.roles };
}
