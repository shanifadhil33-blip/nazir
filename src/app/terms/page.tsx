import Link from 'next/link';
import type { Metadata } from 'next';

export const dynamic = 'force-static';
export const metadata: Metadata = { title: 'Terms | Nazir' };

export default function TermsPage() {
  return <main>
    <h1>Terms</h1>
    <p>These terms describe use of the Nazir prototype.</p>
    <section><h2>Prototype use</h2><p>Nazir tests government service AI agents using fictional services and synthetic test data. It never connects to any real government system.</p></section>
    <section><h2>Your test data</h2><p>Do not enter real personal data. Use only synthetic data. Test conversations may be processed by free third party AI model providers under their own terms and privacy policies.</p></section>
    <section><h2>Accounts</h2><p>When sign in is added, sign in with Google will be used only to identify your account using your name, email and picture.</p></section>
    <section><h2>Hosting and storage</h2><p>The app is hosted on Vercel. Data is kept in a Postgres database hosted by Neon. This scaffold does not yet save conversations or account information.</p></section>
    <section><h2>Limits of results</h2><p>Results apply only within the tested scope and are not a certificate. A result describes the cases tested and does not establish how an agent will behave in other cases. Review results before relying on them.</p></section>
    <section><h2>Contact</h2><p>For questions about these terms, contact <a href="mailto:adhil+bilal@mail.grokbot.com">adhil+bilal@mail.grokbot.com</a>.</p></section>
    <p>Last updated 19 October 2026.</p>
    <p><Link href="/">Back to home</Link></p>
  </main>;
}
