'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import { metricsFromReport, seatFromRoles } from '@/components/ocean/model';
import type { ReportBody } from '@/server/reports/build';
import { DocumentLocale } from './document-locale';
import { ShellHome } from './home';
import { buildHomeView, homeLinks, type HomeView } from './home-model';
import { initialsOf } from './people';

type Membership = { workspaceId: string; workspaceName: string; roles: string[] };
type Loaded = { view: HomeView; roles: string[]; person: { initials: string; name: string } | null; lang: Lang };

/** The signed in home. It reads the same member APIs as the workspace screens, so the server decides what each role may see. */
export function HomeScreen({ workspaceId, initialLang }: { workspaceId: string; initialLang: Lang }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(initialLang);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const langRef = useRef(initialLang);
  const pinned = useRef(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).has('lang'));

  const load = useCallback(async (signal: { cancelled: boolean }) => {
    const headers = { 'accept-language': langRef.current };
    const me = await fetch('/api/me', { headers });
    if (signal.cancelled) return;
    if (me.status === 401) { router.replace('/signin'); return; }
    const meBody = await me.json().catch(() => null);
    const membership = (meBody?.memberships as Membership[] | undefined)?.find((item) => item.workspaceId === workspaceId);
    if (!me.ok || !membership) { setPhase('error'); return; }
    const [settingsResponse, reportsResponse] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/settings`, { headers }).catch(() => null),
      fetch(`/api/workspaces/${workspaceId}/reports`, { headers }).catch(() => null),
    ]);
    if (signal.cancelled) return;
    if (!reportsResponse?.ok) { setPhase('error'); return; }
    const settings = settingsResponse?.ok ? await settingsResponse.json().catch(() => null) as { name?: string; language?: Lang } | null : null;
    const listBody = await reportsResponse.json().catch(() => null) as { reports?: { body: ReportBody; created_at: string }[] } | null;
    if (signal.cancelled) return;
    const reports = listBody?.reports ?? [];
    const latest = reports[0];
    const metrics = latest ? metricsFromReport(latest.body) : null;
    const view = buildHomeView(membership.roles, {
      checks: reports.length,
      score: metrics?.score ?? 0,
      right: metrics?.pass ?? 0,
      toFix: metrics?.fail ?? 0,
      lastAt: latest ? new Date(latest.created_at) : null,
    }, settings?.name || membership.workspaceName);
    const name = typeof meBody?.user?.name === 'string' ? meBody.user.name.trim() : '';
    if (!pinned.current && settings?.language && settings.language !== langRef.current) { langRef.current = settings.language; setLang(settings.language); }
    setData({ view, roles: membership.roles, person: name ? { name: name.split(/\s+/)[0]!, initials: initialsOf(name) } : null, lang: langRef.current });
    setPhase('ready');
  }, [router, workspaceId]);

  useEffect(() => {
    const signal = { cancelled: false };
    load(signal).catch(() => { if (!signal.cancelled) setPhase('error'); });
    return () => { signal.cancelled = true; };
  }, [load, attempt]);

  const seat = seatFromRoles(data?.roles ?? []);
  const ready = phase === 'ready' && data;
  return <>
    <DocumentLocale lang={lang} />
    <ShellHome
      lang={lang}
      seat={seat}
      state={ready ? 'ready' : phase === 'error' ? 'error' : 'loading'}
      view={data?.view}
      person={data?.person ?? undefined}
      links={homeLinks(workspaceId)}
      onRetry={() => { setPhase('loading'); setAttempt((value) => value + 1); }}
    />
  </>;
}
