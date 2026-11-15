import 'server-only';
import { z } from 'zod';
import { withMember } from '../db/context';
import type { TransactionDriver } from '../db/driver';

/** Your language, saved for you only. Other people in the workspace keep theirs. */
export async function setMyLanguage(driver: TransactionDriver, memberId: string, value: unknown) {
  const language = z.enum(['en', 'ar']).parse(value);
  await withMember(driver, memberId, (sql) => sql.query('SELECT nazir.set_my_language($1)', [language]));
  return { language };
}
export async function readMyLanguage(driver: TransactionDriver, memberId: string): Promise<'en' | 'ar' | null> {
  return withMember(driver, memberId, async (sql) => (await sql.query<{ l: 'en' | 'ar' | null }>('SELECT nazir.my_language() AS l')).rows[0]?.l ?? null);
}
