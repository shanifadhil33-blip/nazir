'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { runtimeDriver } from '../db/runtime';
import { allowDemoLogin, demoCallerKey, demoLoginEnabled, demoWorkspaceId, startDemoSession } from './demo';

/** What the picker shows after a refused or failed tap. A good sign in redirects and never returns. */
export type DemoState = { error: 'limit' | 'failed' } | null;

/**
 * Server action behind the demo buttons on /signin. Refuses unless DEMO_LOGIN is on.
 * The language the person chose is kept, so Arabic stays Arabic after the sign in.
 */
export async function demoSignIn(role: string, lang: string): Promise<DemoState> {
  if (!demoLoginEnabled()) throw new Error('Demo sign in is not available.');
  const h = await headers();
  const secure = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]!.trim() === 'https';
  const driver = runtimeDriver();
  try {
    if (!(await allowDemoLogin(driver, demoCallerKey(h, process.env.AUTH_SECRET!)))) return { error: 'limit' };
    const cookie = await startDemoSession(driver, role, secure);
    (await cookies()).set(cookie.name, cookie.value, cookie.options);
  } catch { return { error: 'failed' }; }
  redirect(`/w/${demoWorkspaceId}?lang=${lang === 'ar' ? 'ar' : 'en'}`);
}
