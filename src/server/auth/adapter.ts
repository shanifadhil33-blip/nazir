import 'server-only';
import { createHash } from 'node:crypto';
import type { Adapter, AdapterUser, AdapterSession } from 'next-auth/adapters';
import type { TransactionDriver } from '../db/driver';
import { runtimeDriver } from '../db/runtime';
export const sessionHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function authCall<T extends Record<string, unknown>>(driver: TransactionDriver, name: string, params: unknown[] = [], userId?: string): Promise<T[]> {
  try {
    return await driver.transaction(async (sql) => {
      await sql.query('SET LOCAL ROLE nazir_auth');
      if (userId) await sql.query("SELECT set_config('app.auth_user_id',$1,true)", [userId]);
      return (await sql.query<T>(`SELECT * FROM nazir.${name}(${params.map((_, i) => `$${i + 1}`).join(',')})`, params)).rows;
    });
  } catch { throw new Error('Sign in storage is unavailable. Please try again.'); }
}
const user = (row: Record<string, unknown>): AdapterUser => ({ id: String(row.id), email: String(row.email), name: String(row.name), image: row.image as string | null, emailVerified: null });
export function createAuthAdapter(getDriver: () => TransactionDriver = runtimeDriver): Adapter {
  const call = <T extends Record<string, unknown>>(name: string, params: unknown[]) => authCall<T>(getDriver(), name, params);
  const find = async (name: string, params: unknown[]) => { const rows = await call(name, params); return rows[0] ? user(rows[0]) : null; };
  const session = (row: Record<string, unknown>, token: string): AdapterSession => ({ sessionToken: token, userId: String(row.user_id), expires: new Date(row.expires as string) });
  return {
    async createUser(value) { return (await find('auth_create_user', [value.email.toLowerCase(), value.name, value.image]))!; },
    getUser: (id) => find('auth_get_user', [id]),
    getUserByEmail: (email) => find('auth_get_email', [email.toLowerCase()]),
    getUserByAccount: ({ provider, providerAccountId }) => find('auth_get_account', [provider, providerAccountId]),
    async updateUser(value) { return (await find('auth_update_user', [value.id, JSON.stringify(value)]))!; },
    async linkAccount(value) { await call('auth_link_account', [value.userId, value.provider, value.providerAccountId]); },
    async unlinkAccount({ provider, providerAccountId }) { await call('auth_unlink_account', [provider, providerAccountId]); },
    async createSession(value) { return session((await call('auth_create_session', [sessionHash(value.sessionToken), value.userId, value.expires]))[0]!, value.sessionToken); },
    async getSessionAndUser(token) { const row = (await call('auth_read_session', [sessionHash(token)]))[0]; return row ? { user: user(row.user_data as Record<string, unknown>), session: { sessionToken: token, userId: String((row.user_data as Record<string, unknown>).id), expires: new Date(row.expires as string) } } : null; },
    async updateSession(value) { const row = (await call('auth_update_session', [sessionHash(value.sessionToken), value.expires ?? null]))[0]; return row ? session(row, value.sessionToken) : null; },
    async deleteSession(token) { await call('auth_delete_session', [sessionHash(token)]); },
  };
}
