import { Heading } from '@/components/heading';
import { SignInButton } from '@/components/sign-in-button';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { localeAttrs } from '@/components/shell/locale';
import { HeroPhone } from './landing';
import { SiteBar, SiteFooter } from './site-bar';

/** One card. Google only: no email field, no password, no second sign in link. */
export function SignIn({ lang, action }: { lang: Lang; action: () => Promise<void> }) {
  const copy = messagesFor(lang);
  const attrs = localeAttrs(lang);
  return (
    <div className="nz-site nz-site-signin" {...attrs}>
      <SiteBar lang={lang} path="/signin" />
      <main className="nz-signin-page">
        <div className="nz-signin-card">
          <Heading light={copy.signin.welcome} bold={copy.signin.welcomeBold} lang={lang} />
          <form action={action}><SignInButton lang={lang} /></form>
        </div>
        <div className="nz-signin-art"><HeroPhone lang={lang} /></div>
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
