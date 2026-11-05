'use client';

import { useMemo, useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import { DocumentLocale } from './document-locale';
import { mergeServerFixes, readStore, storeKeyFor } from './fixes-model';
import { HistoryView } from './history';
import { buildHistory, historyAccess } from './history-model';
import { homeLinks } from './home-model';
import { useMemberData } from './member-data';

/** The signed in History. Saved checks from the report API, fixes kept on this device. Hidden for roles the server does not allow. */
export function HistoryScreen({ workspaceId, initialLang }: { workspaceId: string; initialLang: Lang }) {
  const data = useMemberData(workspaceId, initialLang, true, true);
  const [older, setOlder] = useState(false);
  const copy = messagesFor(data.lang);
  const allowed = historyAccess(data.roles);
  const items = useMemo(() => {
    if (data.phase !== 'ready' || !allowed) return [];
    const fixes = mergeServerFixes(readStore(localStorage.getItem(storeKeyFor(workspaceId))), data.fixes);
    return buildHistory(data.reports, fixes, data.lang, copy);
  }, [data.phase, data.reports, data.fixes, data.lang, copy, allowed, workspaceId]);
  const canStart = data.roles.some((role) => role === 'service_owner' || role === 'quality_reviewer');
  return <>
    <DocumentLocale lang={data.lang} />
    <HistoryView
      lang={data.lang} seat={seatFromRoles(data.roles)} phase={data.phase} allowed={allowed || data.phase !== 'ready'} items={items} now={new Date()} older={older}
      assistant={data.assistant} person={data.person} canStart={canStart} links={homeLinks(workspaceId)}
      onOlder={() => setOlder(true)} onRetry={data.reload}
    />
  </>;
}
