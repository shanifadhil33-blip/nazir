import Link from 'next/link';
import { messagesFor, type Lang } from '@/components/ocean/copy';

/** Wordmark, language switch, and (landing only) a quiet Sign in link. */
export function SiteBar({ lang, path, signInLink = false }: { lang: Lang; path: '/' | '/signin'; signInLink?: boolean }) {
  const copy = messagesFor(lang);
  const other = lang === 'ar' ? 'en' : 'ar';
  const switchHref = other === 'ar' ? `${path}?lang=ar` : path;
  return (
    <header className="nz-site-bar">
      <Link href={lang === 'ar' ? '/?lang=ar' : '/'} className="nz-wordmark" aria-label={copy.landing.home}>{messagesFor('en').name}</Link>
      <nav className="nz-site-links" aria-label={copy.name}>
        <Link href={switchHref} lang={other} className="nz-site-link" hrefLang={other}>{copy.landing.switchLanguage}</Link>
        {signInLink ? <Link href={lang === 'ar' ? '/signin?lang=ar' : '/signin'} className="nz-site-link">{copy.signIn}</Link> : null}
      </nav>
    </header>
  );
}

export function SiteFooter({ lang }: { lang: Lang }) {
  const copy = messagesFor(lang);
  return (
    <footer className="nz-site-foot">
      <nav aria-label={copy.landing.footer}>
        <Link href="/privacy">{copy.privacy}</Link>
        <Link href="/terms">{copy.terms}</Link>
      </nav>
    </footer>
  );
}
