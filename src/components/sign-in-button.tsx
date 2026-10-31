'use client';
import { useFormStatus } from 'react-dom';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';

export function SignInButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="nz-signin" disabled={pending} aria-busy={pending ? 'true' : 'false'}>
    <span aria-live="polite">{pending
      ? <>{en.signingIn} <span lang="ar" dir="rtl">{ar.signingIn}</span></>
      : en.signIn}</span>
  </button>;
}
