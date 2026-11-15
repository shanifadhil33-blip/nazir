'use client';

import { useMemo, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import { DocumentLocale } from './document-locale';
import { mergeServerFixes } from './fixes-model';
import { HistoryView } from './history';
import { buildHistory, historyAccess } from './history-model';
import { homeLinks } from './home-model';
import { useMemberData } from './member-data';

/** The signed in History. Saved checks and fixes, both from the server. */
export function HistoryScreen({ workspaceId, initialLang }: { workspaceId: string; initialLang: Lang }) {
  const data = useMemberData(workspaceId, initialLang, true, true);
  const [older, setOlder] = useState(false);
  const copy = messagesFor(data.lang);
  const allowed = historyAccess(data.roles);
  const items = useMemo(() => {
    if (data.phase !== 'ready' || !allowed) return [];
    const fixes = mergeServerFixes([], data.fixes);
    return buildHistory(data.reports, fixes, data.lang, copy);
  }, [data.phase, data.reports, data.fixes, data.lang, copy, allowed]);
  const canStart = data.canStart;
  return <>
    <DocumentLocale lang={data.lang} />
    <HistoryView
      lang={data.lang} seat={seatFromRoles(data.roles)} phase={data.phase} allowed={allowed || data.phase !== 'ready'} items={items} now={new Date()} older={older}
      assistant={data.assistant} person={data.person} canStart={canStart} links={homeLinks(workspaceId)}
      onOlder={() => setOlder(true)} onRetry={data.reload}
    />
  </>;
}
