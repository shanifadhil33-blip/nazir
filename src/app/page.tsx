import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Landing } from '@/components/landing/landing';
import { langOf } from '@/components/landing/lang';
import { LocaleScript } from '@/components/landing/locale-script';
import { DocumentLocale } from '@/components/shell/document-locale';
import { runtimeDriver } from '@/server/db/runtime';
import { ensureHomeWorkspace } from '@/server/auth/workspaces';

export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: { searchParams?: Promise<{ lang?: string }> } = {}) {
  const lang = langOf((await searchParams)?.lang);
  const session = await auth();
  if (session?.user?.id) {
    const workspaceId = await ensureHomeWorkspace(runtimeDriver(), session.user.id);
    redirect(`/w/${workspaceId}`);
  }
  return <><LocaleScript lang={lang} /><DocumentLocale lang={lang} /><Landing lang={lang} /></>;
}
