'use server';

import { signOut } from '@/auth';

/** End the server session before the browser clears its signed in page. */
export async function signOutAction() {
  await signOut({ redirect: false });
}
