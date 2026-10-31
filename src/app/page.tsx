import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
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
  return <main className="nz-legal">
    <h1>{en.name}</h1>
    <p lang="ar" dir="rtl">{ar.name}</p>
    <p>{en.description}</p>
    <p>{en.banner}</p>
    <p lang="ar" dir="rtl">{ar.banner}</p>
    <nav aria-label="Legal"><Link href="/api/auth/signin?callbackUrl=/">{en.signIn}</Link><Link href="/privacy">{en.privacy}</Link><Link href="/terms">{en.terms}</Link></nav>
  </main>;
}
