'use client';

import { useEffect, useRef, useState } from 'react';
import { createHomeRefresh, homeRefreshMemory, nextPollDelay } from './home-refresh';
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
  return <WorkspaceHome key={workspaceId} workspaceId={workspaceId} initialLang={initialLang} initialConnect={initialConnect} />;
}

function WorkspaceHome({ workspaceId, initialLang, initialConnect }: { workspaceId: string; initialLang: Lang; initialConnect?: 'full' | 'quick' }) {
  const data = useMemberData(workspaceId, initialLang, true);
  const { lang, phase, reports, reload, activeRuns: initialRuns } = data;
  const [active, setActive] = useState(() => initialActiveChecks(initialRuns));
  const [memory] = useState(() => homeRefreshMemory(initialRuns));
  const retry = useRef<(() => void) | null>(null);
  useEffect(() => {
    const polling = createHomeRefresh(memory, {
      read: () => readActiveRuns(workspaceId, lang),
      receive: (runs) => setActive((current) => receiveActiveChecks(current, runs)),
      kick: (id) => kickRun(workspaceId, id),
      reload,
    });
    retry.current = () => { void polling.refresh(true); };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.visibilityState === 'hidden') return;
      timer = setTimeout(() => { void polling.refresh().finally(schedule); }, nextPollDelay(memory));
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void polling.refresh().finally(schedule); else clearTimeout(timer); };
    document.addEventListener('visibilitychange', onVisible);
    if (initialRuns == null) void polling.refresh().finally(schedule); else schedule();
    return () => { stopped = true; retry.current = null; polling.dispose(); clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [workspaceId, lang, reload, initialRuns, memory]);
  const completed = reports.filter((report) => isCompleteReport(report.body));
  const latest = completed[0];
  const metrics = latest ? metricsFromReport(latest.body) : null;
  const view = buildHomeView(data.roles, {
    checks: completed.length, total: latest?.body.counts.conversations ?? 0, latestCheckId: latest?.id, score: metrics?.score ?? 0, right: metrics?.pass ?? 0,
    toFix: metrics?.fail ?? 0, inconclusive: latest?.body.counts.inconclusive ?? 0, lastAt: latest ? checkDate(latest.created_at, latest.body) : null,
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
      onRetry={() => retry.current?.()}
      workspaceId={workspaceId} kind={data.kind} connection={data.connection} panel={initialConnect} onConnected={data.reload} active={active.runs} activeStatus={active.status}
    />
  </>;
}
