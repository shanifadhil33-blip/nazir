'use client';
import { useFormStatus } from 'react-dom';
import { messagesFor, type Lang } from '@/components/ocean/copy';

/** One demo person. Pressed state while the sign in runs. */
export function DemoButton({ name, line, lang = 'en' }: { name: string; line: string; lang?: Lang }) {
  const { pending } = useFormStatus();
  const copy = messagesFor(lang);
  return <button type="submit" className="nz-pill-btn nz-pill-btn-quiet nz-pill-btn-neutral nz-demo-btn" disabled={pending} aria-busy={pending ? 'true' : 'false'} data-pending={pending ? 'true' : 'false'}>
    <span className="nz-demo-text">
      <strong>{name}</strong>
      <span>{pending ? copy.signingIn : line}</span>
    </span>
  </button>;
}
