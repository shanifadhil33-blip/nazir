'use client';

import { useId, useRef, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { PillButton } from './pill-button';

/** Confirm before ending work. Keep the decision open if the server refuses it. */
export function ConfirmButton({ lang, label, title, note, failed, disabled, onConfirm }: {
  lang: Lang; label: string; title: string; note: string; failed: string; disabled?: boolean;
  onConfirm?: () => void | boolean | Promise<boolean | undefined>;
}) {
  const text = messagesFor(lang);
  const id = useId(); const dialog = useRef<HTMLDialogElement>(null); const locked = useRef(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  async function confirm() {
    if (locked.current || !onConfirm) return;
    locked.current = true; setBusy(true); setError(false);
    try {
      if (await onConfirm() === false) setError(true);
      else dialog.current?.close();
    } catch { setError(true); }
    finally { locked.current = false; setBusy(false); }
  }
  return <>
    <button type="button" className="nz-quiet-btn" disabled={disabled || busy} onClick={() => { setError(false); dialog.current?.showModal(); }}>{label}</button>
    <dialog ref={dialog} className="nz-confirm" lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-labelledby={id} onCancel={(event) => { if (locked.current) event.preventDefault(); }} onClick={(event) => { if (event.target === event.currentTarget && !locked.current) dialog.current?.close(); }}>
      <h2 id={id}>{title}</h2><p>{note}</p>
      <div className="nz-confirm-actions"><PillButton label={text.settingsScreen.notNow} disabled={busy} onClick={() => dialog.current?.close()} /><PillButton variant="ink" label={busy ? text.checksScreen.stopping : label} disabled={busy} aria-busy={busy} onClick={() => void confirm()} /></div>
      {error ? <p role="alert">{failed}</p> : null}
    </dialog>
  </>;
}
