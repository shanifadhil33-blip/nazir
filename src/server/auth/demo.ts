import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import type { TransactionDriver } from '../db/driver';
import { authCall, sessionHash } from './adapter';

/** Fixed ids from db/migrations/0031_demo_login.sql. */
export const demoWorkspaceId = 'd0000000-0000-4000-8000-000000000100';
export const demoEmailSuffix = '@demo.nazir.test';
export const demoRoles = ['owner', 'editor', 'viewer', 'supplier'] as const;
export type DemoRole = (typeof demoRoles)[number];
/** Demo sessions are short. The database refuses anything over 24 hours. */
export const demoSessionHours = 12;

export const isDemoEmail = (email: string) => email.toLowerCase().endsWith(demoEmailSuffix);
export const isDemoRole = (value: unknown): value is DemoRole => typeof value === 'string' && (demoRoles as readonly string[]).includes(value);

/** One tap demo sign in exists only when it is switched on and sessions can be signed. */
export function demoLoginEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEMO_LOGIN === '1' && Boolean(env.AUTH_SECRET);
}

/** Auth.js v5 database strategy cookie: the raw session token, named by protocol. */
export function demoCookie(token: string, expires: Date, secure: boolean) {
  return {
    name: secure ? '__Secure-authjs.session-token' : 'authjs.session-token',
    value: token,
    options: { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', expires },
  };
}

/** Creates a session for one of the four fixed demo people. Throws on any other role. */
export async function startDemoSession(driver: TransactionDriver, role: unknown, secure: boolean, now = new Date()) {
  if (!isDemoRole(role)) throw new Error('Choose one of the demo people.');
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + demoSessionHours * 60 * 60 * 1000);
  await authCall(driver, 'auth_demo_session', [role, sessionHash(token), expires]);
  return demoCookie(token, expires, secure);
}

/** One caller may start 30 demo sessions in 10 minutes, and everyone together 600 an hour. Enough to try all four people many times. */
export const demoLoginLimit = { perCaller: 30, windowSeconds: 600, overall: 600 } as const;

/** A keyed hash of the caller's address from the proxy header. The address itself is never stored. */
export function demoCallerKey(headerList: Pick<Headers, 'get'>, secret: string): string {
  const forwarded = (headerList.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || headerList.get('x-real-ip')?.trim() || 'unknown';
  return createHmac('sha256', secret).update(`demo-login:${forwarded.slice(0, 100)}`).digest('hex');
}

/** False when this caller (or everyone together) has used up the sign ins for now. */
export async function allowDemoLogin(driver: TransactionDriver, callerKey: string): Promise<boolean> {
  const rows = await authCall<{ auth_demo_login_allowed: boolean }>(driver, 'auth_demo_login_allowed', [callerKey, demoLoginLimit.perCaller, demoLoginLimit.windowSeconds, demoLoginLimit.overall]);
  return rows[0]?.auth_demo_login_allowed === true;
}
