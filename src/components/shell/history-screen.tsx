'use client';

import { useCallback, useEffect, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import type { ActivityPage } from '@/server/shell/history';
import { DocumentLocale } from './document-locale';
import { HistoryView } from './history';
import { historyFromActivity, historyAccess } from './history-model';
import { homeLinks } from './home-model';
import { useMemberData } from './member-data';

/** Audit milestones, loaded on the server for first paint and paged by immutable sequence. */
export function HistoryScreen({ workspaceId, initialLang }: { workspaceId: string; initialLang: Lang }) {
  const data = useMemberData(workspaceId, initialLang, false);
  const [page, setPage] = useState<ActivityPage | null>(data.history ?? null);
  const [failed, setFailed] = useState(false);
  const [older, setOlder] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = messagesFor(data.lang);
  const allowed = historyAccess(data.roles);
  const load = useCallback(async (before?: string | null) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/history${before ? `?before=${before}` : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const next = await response.json() as ActivityPage;
      setPage((current) => before ? { ...next, items: [...(current?.items ?? []), ...next.items].filter((item, i, list) => list.findIndex((other) => other.id === item.id) === i) } : next);
      setFailed(false);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }, [workspaceId]);
  useEffect(() => { if (data.phase === 'ready' && allowed && !page) void Promise.resolve().then(() => load()); }, [data.phase, allowed, page, load]);
  const items = historyFromActivity(page?.items ?? [], data.lang, copy);
  return <>
    <DocumentLocale lang={data.lang} />
    <HistoryView lang={data.lang} seat={seatFromRoles(data.roles)} phase={failed && !page ? 'error' : data.phase === 'ready' && allowed && !page ? 'loading' : data.phase}
      allowed={allowed || data.phase !== 'ready'} items={items} now={new Date()} older={older}
      assistant={data.assistant} person={data.person} canStart={data.canStart} links={homeLinks(workspaceId, data.lang)}
      more={Boolean(page?.cursor)} busy={busy} failed={failed}
      onOlder={() => { setOlder(true); if (page?.cursor && !busy) void load(page.cursor); }} onRetry={() => void load()} />
  </>;
}
