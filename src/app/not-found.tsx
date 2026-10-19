import Link from 'next/link';

export default function NotFound() {
  return <main><h1>Page not found</h1><p>This page could not be found.</p><Link href="/">Back to home</Link></main>;
}
