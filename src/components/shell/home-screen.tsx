'use client';

import type { Lang } from '@/components/ocean/copy';
import { metricsFromReport, seatFromRoles } from '@/components/ocean/model';
import { DocumentLocale } from './document-locale';
import { ShellHome } from './home';
import { buildHomeView, homeLinks } from './home-model';
import { useMemberData } from './member-data';

/** The same role-scoped data powers the server first paint and client refresh. */
export function HomeScreen({ workspaceId, initialLang }: { workspaceId: string; initialLang: Lang }) {
  const data = useMemberData(workspaceId, initialLang, true);
  const { lang, phase, reports } = data;
  const latest = reports[0];
  const metrics = latest ? metricsFromReport(latest.body) : null;
  const view = buildHomeView(data.roles, {
    checks: reports.length, score: metrics?.score ?? 0, right: metrics?.pass ?? 0,
    toFix: metrics?.fail ?? 0, lastAt: latest ? new Date(latest.created_at) : null,
  }, data.assistant);
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
      onRetry={data.reload}
    />
  </>;
}
