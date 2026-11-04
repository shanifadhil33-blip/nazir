import Link from 'next/link';
import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { ShellIcon, type ShellIconName } from '@/components/shell/icons';
import { localeAttrs } from '@/components/shell/locale';
import { SiteBar, SiteFooter } from './site-bar';

export function heroSrc(lang: Lang) {
  return lang === 'ar' ? '/hero-home-ar.png' : '/hero-home-en.png';
}

/** The three small cards, two words each. */
export function landingCards(lang: Lang): Array<{ tone: 'mint' | 'sky' | 'peach'; icon: ShellIconName; label: string }> {
  const copy = messagesFor(lang).landing;
  return [
    { tone: 'mint', icon: 'help', label: copy.askQuestions },
    { tone: 'sky', icon: 'eye', label: copy.seeMistakes },
    { tone: 'peach', icon: 'wrench', label: copy.fixSafely },
  ];
}

export function HeroPhone({ lang }: { lang: Lang }) {
  const copy = messagesFor(lang);
  return (
    <div className="nz-hero-phone">
      {/* A real capture of the built home screen on demo data. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={heroSrc(lang)} alt={copy.landing.heroAlt} width={390} height={820} />
    </div>
  );
}

export function Landing({ lang }: { lang: Lang }) {
  const copy = messagesFor(lang);
  const attrs = localeAttrs(lang);
  const signin = lang === 'ar' ? '/signin?lang=ar' : '/signin';
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
        <ul id="how" className="nz-landing-cards">
          {landingCards(lang).map((card) => (
            <li key={card.tone} className={`nz-landing-card nz-landing-card-${card.tone}`}>
              <span className="nz-landing-ico"><ShellIcon name={card.icon} /></span>
              <span>{card.label}</span>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
