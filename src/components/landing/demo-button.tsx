'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { DemoState } from '@/server/auth/demo-action';

function Button({ name, line, lang, primary }: { name: string; line: string; lang: Lang; primary?: boolean }) {
  const { pending } = useFormStatus();
  const copy = messagesFor(lang);
  return <button type="submit" className={`nz-pill-btn ${primary ? 'nz-pill-btn-ink' : 'nz-pill-btn-quiet nz-pill-btn-neutral'} nz-demo-btn`} disabled={pending} aria-busy={pending ? 'true' : 'false'} data-pending={pending ? 'true' : 'false'}>
    <span className="nz-demo-text">
      <strong>{name}</strong>
      <span>{pending ? copy.signingIn : line}</span>
    </span>
  </button>;
}

/** One demo person: a form of its own. A refused tap says why, in plain words, under the button. */
export function DemoButton({ name, line, lang = 'en', action, primary }: { name: string; line: string; lang?: Lang; action: (previous: DemoState) => Promise<DemoState>; primary?: boolean }) {
  const [state, submit] = useActionState(action, null);
  const copy = messagesFor(lang);
  return <form action={submit}>
    <Button name={name} line={line} lang={lang} primary={primary} />
    {state ? <p className="nz-demo-note" role="alert">{state.error === 'limit' ? copy.signin.demoLimit : copy.signin.demoFailed}</p> : null}
  </form>;
}
