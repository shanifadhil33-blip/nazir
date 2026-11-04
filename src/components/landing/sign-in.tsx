import { Heading } from '@/components/heading';
import { SignInButton } from '@/components/sign-in-button';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { localeAttrs } from '@/components/shell/locale';
import { DemoButton } from './demo-button';
import { HeroPhone } from './landing';
import { SiteBar, SiteFooter } from './site-bar';

/** One card. No email field, no password, no second sign in link. */
const demoPeople = [
  { role: 'owner', name: 'demoOwnerName', line: 'demoOwnerLine' },
  { role: 'editor', name: 'demoEditorName', line: 'demoEditorLine' },
  { role: 'viewer', name: 'demoViewerName', line: 'demoViewerLine' },
  { role: 'supplier', name: 'demoSupplierName', line: 'demoSupplierLine' },
] as const;

/** Google only, plus the demo picker when the server passes demoAction (DEMO_LOGIN is on). */
export function SignIn({ lang, action, demoAction }: { lang: Lang; action: () => Promise<void>; demoAction?: (role: string) => Promise<void> }) {
  const copy = messagesFor(lang);
  const attrs = localeAttrs(lang);
  return (
    <div className="nz-site nz-site-signin" {...attrs}>
      <SiteBar lang={lang} path="/signin" />
      <main className="nz-signin-page">
        <div className="nz-signin-card">
          <Heading light={copy.signin.welcome} bold={copy.signin.welcomeBold} lang={lang} />
          <form action={action}><SignInButton lang={lang} /></form>
          {demoAction ? <section id="demo" className="nz-demo-picker" aria-labelledby="nz-demo-title">
            <h2 id="nz-demo-title" className="nz-demo-title">{copy.signin.demoTitle}</h2>
            <div className="nz-demo-list">
              {demoPeople.map((person) => <form key={person.role} action={demoAction.bind(null, person.role)}>
                <DemoButton name={copy.signin[person.name]} line={copy.signin[person.line]} lang={lang} />
              </form>)}
            </div>
            <p className="nz-demo-next">{copy.signin.demoNext}</p>
          </section> : null}
        </div>
        <div className="nz-signin-art"><HeroPhone lang={lang} /></div>
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
