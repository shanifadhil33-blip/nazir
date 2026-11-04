'use client';

import { useState } from 'react';
import { ShellIcon } from './icons';

/** The bell opens a small note on tap and closes on the next tap, so it never feels dead. */
export function Bell({ label, empty }: { label: string; empty: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="nz-bell-wrap">
      <button type="button" className="nz-bell" aria-label={label} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ShellIcon name="bell" />
      </button>
      {open ? <p className="nz-bell-note" role="status">{empty}</p> : null}
    </div>
  );
}
