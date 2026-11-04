'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { runtimeDriver } from '../db/runtime';
import { demoLoginEnabled, demoWorkspaceId, startDemoSession } from './demo';

/** Server action behind the demo buttons on /signin. Refuses unless DEMO_LOGIN is on. */
export async function demoSignIn(role: string): Promise<void> {
  if (!demoLoginEnabled()) throw new Error('Demo sign in is not available.');
  const h = await headers();
  const secure = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]!.trim() === 'https';
  const cookie = await startDemoSession(runtimeDriver(), role, secure);
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
  redirect(`/w/${demoWorkspaceId}`);
}
