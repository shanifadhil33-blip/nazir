'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** Keep a selected detail and the previous list position in view before paint. */
export function useListDetailScroll(open: boolean, list: string) {
  const positions = useRef(new Map<string, number>());
  const previous = useRef({ open, list });
  const remember = useCallback(() => {
    if (!open) positions.current.set(list, window.scrollY);
  }, [open, list]);

  useEffect(() => {
    if (open) return;
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [open, remember]);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { open, list };
    if (before.open === open && before.list === list) return;
    // A long desktop list can also leave the detail above the viewport.
    const detail = document.querySelector('.nz-check-page');
    const top = open ? Math.max(0, (detail?.getBoundingClientRect().top ?? 0) + window.scrollY - 16) : positions.current.get(list) ?? 0;
    window.scrollTo({ top, behavior: 'instant' });
  }, [open, list]);

  return remember;
}
