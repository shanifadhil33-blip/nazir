import Link from 'next/link';
import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { localeAttrs } from '@/components/shell/locale';
import type { DemoState } from '@/server/auth/demo-action';
import { DemoButton } from './demo-button';
import { SiteBar, SiteFooter } from './site-bar';
export function DemoStart({ lang, action }: { lang: Lang; action?: (previous: DemoState) => Promise<DemoState> }) {
  const copy = messagesFor(lang); const text = copy.demo;
  return <div className="nz-site nz-site-demo" {...localeAttrs(lang)}><SiteBar lang={lang} path="/demo" />
    <main className="nz-demo-start"><span className="nz-demo-sample">{copy.shell.sample}</span>
      <Heading light={text.title} bold={text.titleBold} lang={lang} />
      <p>{text.intro}</p>
      <section id="demo">{action ? <DemoButton primary name={text.start} line={text.asOmar} lang={lang} action={action} /> : <p>{text.unavailable}</p>}</section>
      <p className="nz-demo-safe">{text.safe}</p><Link href={`/signin?lang=${lang}`}>{text.ownAccount}</Link>
    </main><SiteFooter lang={lang} /></div>;
}
