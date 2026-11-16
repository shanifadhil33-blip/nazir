'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import type { BellData } from '@/server/shell/bell';
import { dateTimeLabel } from './checks-model';
import { activityDetail, sentenceFor } from './history-model';
import { ShellIcon } from './icons';

/** Completed events from History. A failed seen write keeps the unread count. */
export function Bell({ lang, home }: { lang: Lang; home: string }) {
  const copy = messagesFor(lang);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BellData | null>(null);
  const [failed, setFailed] = useState(false);
  const workspace = /^\/w\/([0-9a-f-]{36})(?:\?|$)/i.exec(home)?.[1] ?? null;
  const alive = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const reading = useRef(false);
  const load = useCallback(async () => {
    if (!workspace || reading.current) return null;
    reading.current = true;
    try {
      const response = await fetch(`/api/workspaces/${workspace}/bell`, { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const next = await response.json() as BellData;
      if (alive.current) { setData(next); setFailed(false); }
      return next;
    } catch { if (alive.current) setFailed(true); return null; }
    finally { reading.current = false; }
  }, [workspace]);
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(load);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  async function show() {
    setOpen(true);
    const next = await load();
    if (!next || !workspace) return;
    const response = await fetch(`/api/workspaces/${workspace}/bell`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ through: next.through }) }).catch(() => null);
    if (response?.ok && alive.current) setData((current) => current?.through === next.through ? { ...current, unread: 0 } : current);
  }
  const unread = data?.unread ?? 0;
  const pinned = (href: string) => `${href}${href.includes('?') ? '&' : '?'}lang=${lang}`;
  return (
    <div className="nz-bell-wrap" ref={wrap}>
      <button type="button" className="nz-bell" aria-label={unread ? `${copy.shell.alerts}, ${unread}` : copy.shell.alerts} aria-expanded={open} onClick={() => open ? setOpen(false) : void show()}>
        <ShellIcon name="bell" />{unread ? <span className="nz-bell-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? <div className="nz-bell-panel">
        {failed ? <button type="button" className="nz-text-link" onClick={() => void show()}>{copy.shell.retry}</button> : !data && workspace ? <div className="nz-skeleton" aria-busy="true" /> : data?.items.length ? <ul className="nz-bell-list">{data.items.map((item) => <li key={item.id}><Link href={pinned(item.href)} onClick={() => setOpen(false)}><strong>{sentenceFor({ kind: item.kind }, copy)}</strong><span dir="auto">{activityDetail(item, lang, copy)}</span><small>{dateTimeLabel(new Date(item.at), lang)}</small></Link></li>)}</ul> : <p role="status">{copy.shell.noAlerts}</p>}
        <Link className="nz-text-link" href={pinned(`${home.split('?')[0]}?screen=history`)} onClick={() => setOpen(false)}>{copy.shell.seeAll}</Link>
      </div> : null}
    </div>
  );
}
