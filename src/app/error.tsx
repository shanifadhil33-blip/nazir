'use client';

import Link from 'next/link';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="nz-legal"><h1>Something went wrong</h1><p>Please try again.</p><button type="button" onClick={reset}>Try again</button><p><Link href="/">Back to home</Link></p></main>;
}
