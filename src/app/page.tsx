import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { SignInButton } from '@/components/sign-in-button';
import { runtimeDriver } from '@/server/db/runtime';
import { ensureHomeWorkspace } from '@/server/auth/workspaces';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await auth();
  if (session?.user?.id) {
    const workspaceId = await ensureHomeWorkspace(runtimeDriver(), session.user.id);
    redirect(`/w/${workspaceId}`);
  }
  async function signInWithGoogle() {
    'use server';
    await signIn('google', { redirectTo: '/w' });
  }
  return <main className="nz-legal">
    <h1>{en.name}</h1>
    <p lang="ar" dir="rtl">{ar.name}</p>
    <p>{en.description}</p>
    <p>{en.banner}</p>
    <p lang="ar" dir="rtl">{ar.banner}</p>
    <nav aria-label="Legal"><form action={signInWithGoogle}><SignInButton /></form><Link href="/privacy">{en.privacy}</Link><Link href="/terms">{en.terms}</Link></nav>
  </main>;
}
