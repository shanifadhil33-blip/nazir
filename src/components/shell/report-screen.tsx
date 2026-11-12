'use client';

import { useState } from 'react';
import type { Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import { DocumentLocale } from './document-locale';
import { historyAccess } from './history-model';
import { homeLinks } from './home-model';
import { useMemberData } from './member-data';
import { ReportView, type ReportNote } from './report';
import { factsFromReports, shareHref } from './report-model';

/** The signed in Report. Numbers come from the newest saved check. */
export function ReportScreen({ workspaceId, initialLang }: { workspaceId: string; initialLang: Lang }) {
  const data = useMemberData(workspaceId, initialLang, true);
  const [note, setNote] = useState<ReportNote>(null);
  const now = new Date();
  const facts = data.phase === 'ready' ? factsFromReports(data.reports, now) : null;

  async function share() {
    if (!facts || note === 'sharing') return;
    const url = `${window.location.origin}${shareHref(workspaceId, facts.id)}`;
    setNote('sharing');
    try {
      if (typeof navigator.share === 'function') { await navigator.share({ url }); setNote(null); return; }
      await navigator.clipboard.writeText(url);
      setNote('copied');
    } catch (error) {
      // Closing the share sheet is not a failure.
      setNote((error as { name?: string })?.name === 'AbortError' ? null : 'shareFailed');
    }
  }

  return <>
    <DocumentLocale lang={data.lang} />
    <ReportView
      lang={data.lang} seat={seatFromRoles(data.roles)} phase={data.phase} facts={facts} workspaceId={workspaceId}
      assistant={data.assistant} person={data.person} canStart={data.canStart}
      canExport={data.canStart} history={historyAccess(data.roles)} links={homeLinks(workspaceId)} now={now} note={note}
      onDownload={() => setNote('downloading')} onShare={() => void share()} onRetry={data.reload}
    />
  </>;
}
