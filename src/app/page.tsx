import Link from 'next/link';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';

export const dynamic = 'force-static';

export default function HomePage() {
  return <main>
    <h1>{en.name}</h1>
    <p lang="ar" dir="rtl">{ar.name}</p>
    <p>{en.description}</p>
    <p>{en.banner}</p>
    <p lang="ar" dir="rtl">{ar.banner}</p>
    <nav aria-label="Legal"><Link href="/privacy">{en.privacy}</Link><Link href="/terms">{en.terms}</Link></nav>
  </main>;
}
