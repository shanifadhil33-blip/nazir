import Link from 'next/link';
import type { ReactNode } from 'react';
import { Heading } from '@/components/heading';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { ShellIcon } from '@/components/shell/icons';
import { localeAttrs } from '@/components/shell/locale';
import styles from './how.module.css';
import { SiteBar, SiteFooter } from './site-bar';

export function heroSrc(lang: Lang) {
  return lang === 'ar' ? '/hero-home-ar.png' : '/hero-home-en.png';
}

const latinToken = /^(https|SDK|NAZIR_KEY|OpenAI|Node|Python)$/;

/** Keep short Latin names in reading order inside Arabic. */
function Text({ text }: { text: string }) {
  const parts = text.split(/(https|SDK|NAZIR_KEY|OpenAI|Node|Python)/g);
  return parts.map((part, index) => latinToken.test(part) ? <bdi key={index} dir="ltr">{part}</bdi> : part);
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <div className={styles.part}><h3>{title}</h3>{children}</div>;
}

/** The four parts of How it works, in reading order. */
export function landingSteps(lang: Lang): string[] {
  const copy = messagesFor(lang).landing;
  return [copy.connectTitle, copy.checksTitle, copy.backTitle, copy.privacyTitle];
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
  const text = copy.landing;
  const attrs = localeAttrs(lang);
  const signin = `/demo?lang=${lang}`;
  return (
    <div className="nz-site" {...attrs}>
      <SiteBar lang={lang} path="/" signInLink />
      <main className="nz-landing">
        <section className="nz-hero-copy">
          <Heading light={text.lightLine} bold={text.boldLine} lang={lang} />
          <div className="nz-hero-actions">
            <Link href={signin} className="nz-pill-btn nz-pill-btn-ink nz-hero-btn">
              <span className="nz-pill-ico"><ShellIcon name="play" directional /></span>
              <span>{text.tryDemo}</span>
            </Link>
            <Link href="#how" className="nz-pill-btn nz-pill-btn-quiet nz-pill-btn-neutral nz-hero-btn">
              <span>{text.howItWorks}</span>
            </Link>
          </div>
          <p className="nz-hero-note">{text.free}</p>
        </section>
        <HeroPhone lang={lang} />
        <section id="how" className={styles.how} aria-labelledby="how-heading">
          <h2 id="how-heading">{text.howItWorks}</h2>
          <p><Text text={text.lead} /></p>
          <p><Text text={text.cannotChange} /></p>
          <Block title={text.connectTitle}>
            <p><Text text={text.connectNeed} /></p>
            <p><Text text={text.connectNoCode} /></p>
            <h4>{text.quickTitle}</h4>
            <p><Text text={text.quickBody} /></p>
            <ul>
              <li><Text text={text.quickOpen} /></li>
              <li><Text text={text.quickSimple} /></li>
              <li><Text text={text.quickA2a} /></li>
            </ul>
            <p><Text text={text.quickKey} /></p>
            <p><Text text={text.quickTest} /></p>
            <h4><Text text={text.fullTitle} /></h4>
            <p><Text text={text.fullBody} /></p>
            <p><Text text={text.fullProof} /></p>
            <ol>
              <li><Text text={text.fullStep1} /></li>
              <li><Text text={text.fullStep2} /></li>
              <li><Text text={text.fullStep3} /></li>
            </ol>
            <p><Text text={text.fullSeen} /></p>
            <p><Text text={text.fullUsers} /></p>
            <p><Text text={text.fullDry} /></p>
          </Block>
          <Block title={text.checksTitle}>
            <p><Text text={text.checksPick} /></p>
            <h4>{text.answersTitle}</h4>
            <p><Text text={text.answersBody} /></p>
            <p><Text text={text.answersMark} /></p>
            <p><Text text={text.answersStop} /></p>
            <p><Text text={text.answersTime} /></p>
            <h4>{text.safetyTitle}</h4>
            <p><Text text={text.safetyBody} /></p>
            <p><Text text={text.safetyOwn} /></p>
            <p><Text text={text.safetyFile} /></p>
            <p><Text text={text.safetyFileNote} /></p>
            <p><Text text={text.safetyCopy} /></p>
            <ul>
              <li><Text text={text.trickRules} /></li>
              <li><Text text={text.trickFile} /></li>
              <li><Text text={text.trickRole} /></li>
              <li><Text text={text.trickPressure} /></li>
              <li><Text text={text.trickPrompt} /></li>
              <li><Text text={text.trickTools} /></li>
              <li><Text text={text.trickOther} /></li>
              <li><Text text={text.trickChange} /></li>
              <li><Text text={text.trickPeople} /></li>
              <li><Text text={text.trickPeopleNote} /></li>
              <li><Text text={text.trickSteps} /></li>
            </ul>
            <p><Text text={text.safetyScope} /></p>
            <p><Text text={text.safetyTime} /></p>
          </Block>
          <Block title={text.backTitle}>
            <p><Text text={text.backChecks} /></p>
            <p><Text text={text.backReport} /></p>
            <p><Text text={text.backReportFile} /></p>
            <p><Text text={text.backFixes} /></p>
            <p><Text text={text.backApprove} /></p>
            <p><Text text={text.backAfter} /></p>
            <p><Text text={text.backHistory} /></p>
            <p><Text text={text.backMap} /></p>
            <p><Text text={text.backRisk} /></p>
            <p><Text text={text.backDanger} /></p>
            <p><Text text={text.backNoSdk} /></p>
          </Block>
          <Block title={text.privacyTitle}>
            <p><Text text={text.privacyAddress} /></p>
            <p><Text text={text.privacyKey} /></p>
            <p><Text text={text.privacySdkKey} /></p>
            <p><Text text={text.privacyLogins} /></p>
            <p><Text text={text.privacyStore} /></p>
            <p><Text text={text.privacyUsers} /></p>
          </Block>
        </section>
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}
