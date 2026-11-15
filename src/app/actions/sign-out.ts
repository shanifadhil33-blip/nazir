'use server';

import { signOut } from '@/auth';

/** Sign out and land on the sign in page. */
export async function signOutAction() {
  await signOut({ redirectTo: '/signin' });
}
