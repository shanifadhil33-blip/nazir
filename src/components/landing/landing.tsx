import Link from 'next/link';
import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { ShellIcon } from '@/components/shell/icons';
import { localeAttrs } from '@/components/shell/locale';
import { SiteBar, SiteFooter } from './site-bar';

export function heroSrc(lang: Lang) {
  return lang === 'ar' ? '/hero-home-ar.png' : '/hero-home-en.png';
}

/** Three plain lines describing the actual flow. */
export function landingSteps(lang: Lang): string[] {
  const copy = messagesFor(lang).landing;
  return [copy.askQuestions, copy.seeMistakes, copy.fixSafely];
}

export function HeroPhone({ lang }: { lang: Lang }) {
  const copy = messagesFor(lang);
  return (
    <div className="nz-hero-phone">
      {/* A real capture of the built home screen on demo data. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={heroSrc(lang)} alt={copy.landing.heroAlt} width={390} height={844} />
    </div>
  );
}

export function Landing({ lang }: { lang: Lang }) {
  const copy = messagesFor(lang);
  const attrs = localeAttrs(lang);
  const signin = `/demo?lang=${lang}`;
  return (
    <div className="nz-site" {...attrs}>
      <SiteBar lang={lang} path="/" signInLink />
      <main className="nz-landing">
        <section className="nz-hero-copy">
          <Heading light={copy.landing.lightLine} bold={copy.landing.boldLine} lang={lang} />
          <div className="nz-hero-actions">
            <Link href={signin} className="nz-pill-btn nz-pill-btn-ink nz-hero-btn">
              <span className="nz-pill-ico"><ShellIcon name="play" directional /></span>
              <span>{copy.landing.tryDemo}</span>
            </Link>
            <Link href="#how" className="nz-pill-btn nz-pill-btn-quiet nz-pill-btn-neutral nz-hero-btn">
              <span>{copy.landing.howItWorks}</span>
            </Link>
          </div>
          <p className="nz-hero-note">{copy.landing.free}</p>
        </section>
        <HeroPhone lang={lang} />
        <ul id="how" className="nz-landing-steps">
          {landingSteps(lang).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
