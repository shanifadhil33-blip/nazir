import Link from 'next/link';
import type { Metadata } from 'next';

export const dynamic = 'force-static';
export const metadata: Metadata = { title: 'Privacy | Nazir' };

export default function PrivacyPage() {
  return <main>
    <h1>Privacy</h1>
    <p>This page explains how Nazir handles information in this prototype.</p>
    <section><h2>Fictional services and test data</h2><p>Nazir uses fictional services and synthetic test data. It never connects to any real government system. Do not enter real personal data.</p></section>
    <section><h2>Test conversations</h2><p>Test conversations may be processed by free third party AI model providers. Only synthetic data is used. Those providers may handle conversations under their own terms and privacy policies.</p></section>
    <section><h2>Account information</h2><p>When sign in is added, sign in with Google will be used only to identify your account using your name, email and picture.</p></section>
    <section><h2>Storage</h2><p>The app is hosted on Vercel. Data is kept in a Postgres database hosted by Neon. This scaffold does not yet save conversations or account information.</p></section>
    <section><h2>Test results</h2><p>Results apply only within the tested scope. They are not a certificate.</p></section>
    <section><h2>Contact</h2><p>For questions about privacy or data removal, contact <a href="mailto:adhil+bilal@mail.grokbot.com">adhil+bilal@mail.grokbot.com</a>.</p></section>
    <p>Last updated 19 October 2026.</p>
    <p><Link href="/">Back to home</Link></p>
  </main>;
}
