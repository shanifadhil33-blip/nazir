import Link from 'next/link';
import { Heading } from '@/components/heading';
import { SignInButton } from '@/components/sign-in-button';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { localeAttrs } from '@/components/shell/locale';
import { SiteBar, SiteFooter } from './site-bar';

/** Your own account has one door. The sample has its own page. */
export function SignIn({ lang, action }: { lang: Lang; action: () => Promise<void> }) {
  const copy = messagesFor(lang);
  return <div className="nz-site nz-site-signin" {...localeAttrs(lang)}>
    <SiteBar lang={lang} path="/signin" />
    <main className="nz-signin-page nz-signin-solo"><div className="nz-signin-card">
      <Heading light={copy.signin.welcome} bold={copy.signin.welcomeBold} lang={lang} />
      <p>{copy.signin.ownLine}</p>
      <form action={action}><SignInButton lang={lang} /></form>
      <Link className="nz-signin-demo-link" href={`/demo?lang=${lang}`}>{copy.signin.demoLink}</Link>
    </div></main><SiteFooter lang={lang} />
  </div>;
}
