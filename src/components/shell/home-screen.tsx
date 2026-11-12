'use client';

import { useEffect, useState } from 'react';
import { initialActiveChecks, receiveActiveChecks } from './checks-active';
import { readActiveRuns, kickRun } from './checks-run';
import { checkDate } from '@/server/reports/date';

import { isCompleteReport } from '@/server/reports/build';
import type { Lang } from '@/components/ocean/copy';
import { metricsFromReport, seatFromRoles } from '@/components/ocean/model';
import { DocumentLocale } from './document-locale';
import { ShellHome } from './home';
import { buildHomeView, homeLinks } from './home-model';
import { useMemberData } from './member-data';

/** The same role-scoped data powers the server first paint and client refresh. */
export function HomeScreen({ workspaceId, initialLang, initialConnect }: { workspaceId: string; initialLang: Lang; initialConnect?: 'full' | 'quick' }) {
  const data = useMemberData(workspaceId, initialLang, true);
  const { lang, phase, reports, reload, activeRuns: initialRuns } = data;
  const [active, setActive] = useState(() => initialActiveChecks(initialRuns));
  useEffect(() => {
    let alive = true; let reading = false;
    const refresh = async () => {
      if (reading) return; reading = true;
      try {
        const runs = await readActiveRuns(workspaceId, lang);
        if (!alive) return;
        setActive((current) => receiveActiveChecks(current, runs));
        for (const run of runs ?? []) void kickRun(workspaceId, run.runId);
        if (!runs?.length) reload();
      } finally { reading = false; }
    };
    const timer = setInterval(() => void refresh(), 5000);
    if (initialRuns == null) void refresh();
    return () => { alive = false; clearInterval(timer); };
  }, [workspaceId, lang, reload, initialRuns]);
  const completed = reports.filter((report) => isCompleteReport(report.body));
  const latest = completed[0];
  const metrics = latest ? metricsFromReport(latest.body) : null;
  const view = buildHomeView(data.roles, {
    checks: completed.length, total: latest?.body.counts.conversations ?? 0, latestCheckId: latest?.id, score: metrics?.score ?? 0, right: metrics?.pass ?? 0,
    toFix: metrics?.fail ?? 0, lastAt: latest ? checkDate(latest.created_at, latest.body) : null,
  }, data.assistant, data.kind === 'demo' || data.connection?.ready === true);
  const seat = seatFromRoles(data.roles);
  const ready = phase === 'ready';
  return <>
    <DocumentLocale lang={lang} />
    <ShellHome
      lang={lang}
      seat={seat}
      state={ready ? 'ready' : phase === 'error' ? 'error' : 'loading'}
      view={view}
      person={data.person}
      links={homeLinks(workspaceId)}
      onRetry={() => { reload(); void readActiveRuns(workspaceId, lang).then((runs) => setActive((current) => receiveActiveChecks(current, runs))); }}
      workspaceId={workspaceId} kind={data.kind} connection={data.connection} panel={initialConnect} onConnected={data.reload} active={active.runs} activeStatus={active.status}
    />
  </>;
}
