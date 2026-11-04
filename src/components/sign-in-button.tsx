'use client';
import { useFormStatus } from 'react-dom';
import { messagesFor, type Lang } from '@/components/ocean/copy';

function GoogleMark() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="nz-google-mark">
    <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z" />
    <path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.8 0-5.2-1.9-6-4.5H2.4v2.8A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M6 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.4a11 11 0 0 0 0 9.8L6 14.1z" />
    <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.4 7.1L6 9.9c.8-2.6 3.2-4.5 6-4.5z" />
  </svg>;
}

/** Google button with a pressed state. Reads the language it is given, one language at a time. */
export function SignInButton({ lang = 'en' }: { lang?: Lang }) {
  const { pending } = useFormStatus();
  const copy = messagesFor(lang);
  return <button type="submit" className="nz-signin" disabled={pending} aria-busy={pending ? 'true' : 'false'} data-pending={pending ? 'true' : 'false'}>
    <span className="nz-signin-ico">{pending ? <span className="nz-spin nz-spin-dark" aria-hidden="true" /> : <GoogleMark />}</span>
    <span aria-live="polite">{pending ? copy.signingIn : copy.signin.google}</span>
  </button>;
}
