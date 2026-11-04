import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { SignIn } from '@/components/landing/sign-in';
import { LocaleScript } from '@/components/landing/locale-script';
import { DocumentLocale } from '@/components/shell/document-locale';
import { langOf } from '@/components/landing/lang';
import { ensureHomeWorkspace } from '@/server/auth/workspaces';
import { runtimeDriver } from '@/server/db/runtime';

export const dynamic = 'force-dynamic';

export default async function SignInPage({ searchParams }: { searchParams?: Promise<{ lang?: string }> } = {}) {
  const lang = langOf((await searchParams)?.lang);
  const session = await auth();
  if (session?.user?.id) {
    const workspaceId = await ensureHomeWorkspace(runtimeDriver(), session.user.id);
    redirect(`/w/${workspaceId}`);
  }
  async function signInWithGoogle() {
    'use server';
    await signIn('google', { redirectTo: '/w' });
  }
  return <><LocaleScript lang={lang} /><DocumentLocale lang={lang} /><SignIn lang={lang} action={signInWithGoogle} /></>;
}
