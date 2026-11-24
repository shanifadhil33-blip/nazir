'use client';

import { useRef, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { localeAttrs } from './locale';
import { PillButton } from './pill-button';
import { ShellIcon } from './icons';

/** The native top layer keeps the confirmation above the shell and traps keyboard focus. */
export function SignOutControl({ lang, action }: { lang: Lang; action?: (form: FormData) => void | Promise<void> }) {
  const text = messagesFor(lang).settingsScreen;
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function confirm() {
    if (locked.current || !action) return;
    locked.current = true; setBusy(true); setFailed(false);
    try {
      await action(new FormData());
      window.location.replace(`/?lang=${lang}`);
    } catch {
      locked.current = false; setBusy(false); setFailed(true);
    }
  }
  return <>
    <button type="button" className="nz-set-head" onClick={() => { setFailed(false); dialog.current?.showModal(); }}>
      <span className="nz-set-ico nz-set-ico-sky" aria-hidden="true"><ShellIcon name="people" /></span>
      <span className="nz-set-text"><strong>{text.signOut}</strong></span>
    </button>
    <dialog ref={dialog} className="nz-confirm" {...localeAttrs(lang)} aria-labelledby="nz-signout-title" aria-describedby="nz-signout-note" onCancel={(event) => { if (locked.current) event.preventDefault(); }} onClick={(event) => { if (event.target === event.currentTarget && !locked.current) dialog.current?.close(); }}>
      <h2 id="nz-signout-title">{text.signOutTitle}</h2>
      <p id="nz-signout-note">{text.signOutNote}</p>
      <div className="nz-confirm-actions">
        <PillButton label={text.notNow} disabled={busy} onClick={() => dialog.current?.close()} />
        <PillButton variant="ink" label={busy ? text.signingOut : text.signOut} disabled={busy} aria-busy={busy} onClick={() => void confirm()} />
      </div>
      {failed ? <p role="alert">{text.signOutFailed}</p> : null}
    </dialog>
  </>;
}
