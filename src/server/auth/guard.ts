import 'server-only';
import type { SqlConnection } from '../db/driver';
import { Forbidden } from '../http/errors';
import { can, type Action, type Role } from './roles';
export { Forbidden } from '../http/errors';
/** Call on the reserved connection inside withMember. */
export async function requireRole(connection: SqlConnection, action: Action): Promise<void> {
  const { rows } = await connection.query<{ role: Role }>('SELECT role FROM nazir.member_roles WHERE member_id=nazir.current_member_id()');
  if (!can(rows.map((row) => row.role), action)) throw new Forbidden();
}
