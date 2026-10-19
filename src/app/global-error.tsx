'use client';

import Link from 'next/link';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body style={{ color: '#000000', background: '#FFFFFF', fontFamily: 'system-ui, sans-serif', fontSize: '16px', lineHeight: 1.6, maxWidth: '42rem', margin: '0 auto', padding: '1.5rem' }}>
    <main><h1>Something went wrong</h1><p>Please try again.</p><button style={{ color: 'inherit', background: '#FFFFFF', font: 'inherit' }} onClick={reset}>Try again</button><p><Link style={{ color: 'inherit' }} href="/">Back to home</Link></p></main>
  </body></html>;
}
