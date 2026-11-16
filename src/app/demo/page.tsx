import { DemoStart } from '@/components/landing/demo-start';
import { LocaleScript } from '@/components/landing/locale-script';
import { DocumentLocale } from '@/components/shell/document-locale';
import { langOf } from '@/components/landing/lang';
import { demoSignIn } from '@/server/auth/demo-action';
import { demoLoginEnabled } from '@/server/auth/demo';
export const dynamic = 'force-dynamic';
export default async function DemoPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang = langOf((await searchParams).lang);
  return <><LocaleScript lang={lang} /><DocumentLocale lang={lang} /><DemoStart lang={lang} action={demoLoginEnabled() ? demoSignIn.bind(null, 'owner', lang) : undefined} /></>;
}
