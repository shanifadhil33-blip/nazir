'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import { initialsOf } from './people';
import { useMemberSnapshot, type MemberSnapshot, type LoadedSettings, type SavedReport } from './member-snapshot';
import type { ServerFix } from './fixes-model';
export type { LoadedSettings, SavedReport } from './member-snapshot';

type Membership = { workspaceId: string; workspaceName: string; roles: string[] };
export type MemberData = MemberSnapshot & {
  phase: 'loading' | 'ready' | 'error';
  reload: () => void;
  setReports: (reports: SavedReport[]) => void;
};

/** Each API enforces membership itself, so all requests can start together. */
export async function fetchMemberSnapshot(workspaceId: string, lang: Lang, pinned: boolean, withReports: boolean, withFixes: boolean): Promise<MemberSnapshot | 'unauthorized'> {
  const options = { headers: { 'accept-language': lang }, cache: 'no-store' as const };
  const [me, settingsResponse, reportsResponse, fixesResponse] = await Promise.all([
    fetch('/api/me', options),
    fetch(`/api/workspaces/${workspaceId}/settings`, options).catch(() => null),
    withReports ? fetch(`/api/workspaces/${workspaceId}/reports`, options).catch(() => null) : null,
    withFixes ? fetch(`/api/workspaces/${workspaceId}/proposals`, options).catch(() => null) : null,
  ]);
  if ([me, settingsResponse, reportsResponse, fixesResponse].some((r) => r?.status === 401)) return 'unauthorized';
  const meBody = await me.json().catch(() => null);
  const member = (meBody?.memberships as Membership[] | undefined)?.find((item) => item.workspaceId === workspaceId);
  if (!me.ok || !member || (withReports && !reportsResponse?.ok)) throw new Error('Member data unavailable');
  const [settings, list, shared] = await Promise.all([
    settingsResponse?.ok ? settingsResponse.json().catch(() => null) as Promise<LoadedSettings> : null,
    reportsResponse?.ok ? reportsResponse.json().catch(() => null) as Promise<{ reports?: SavedReport[] } | null> : null,
    fixesResponse?.ok ? fixesResponse.json().catch(() => null) as Promise<{ proposals?: ServerFix[] } | null> : null,
  ]);
  const name = typeof meBody?.user?.name === 'string' ? meBody.user.name.trim() : '';
  return { workspaceId, lang: !pinned && settings?.language ? settings.language : lang, roles: member.roles,
    assistant: settings?.name || member.workspaceName, fullName: name,
    person: name ? { name: name.split(/\s+/)[0]!, initials: initialsOf(name) } : undefined,
    settings, reports: list?.reports ?? [], fixes: shared?.proposals ?? [] };
}

export function useMemberData(workspaceId: string, initialLang: Lang, withReports: boolean, withFixes = false): MemberData {
  const router = useRouter();
  const initial = useMemberSnapshot(workspaceId);
  const [data, setData] = useState<MemberSnapshot>(() => initial ?? { workspaceId, lang: initialLang, roles: [], assistant: '', person: undefined, fullName: '', settings: null, reports: [], fixes: [] });
  const [phase, setPhase] = useState<MemberData['phase']>(initial ? 'ready' : 'loading');
  const [attempt, setAttempt] = useState(0);
  const langRef = useRef(data.lang);
  const pinned = useRef(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).has('lang'));
  useEffect(() => {
    if (initial && attempt === 0) return;
    let cancelled = false;
    fetchMemberSnapshot(workspaceId, langRef.current, pinned.current, withReports, withFixes).then((loaded) => {
      if (cancelled) return;
      if (loaded === 'unauthorized') { router.replace('/signin'); return; }
      langRef.current = loaded.lang;
      setData(loaded);
      setPhase('ready');
    }).catch(() => { if (!cancelled) setPhase('error'); });
    return () => { cancelled = true; };
  }, [router, workspaceId, initial, attempt, withReports, withFixes]);
  const reload = useCallback(() => { setPhase('loading'); setAttempt((value) => value + 1); }, []);
  const setReports = useCallback((reports: SavedReport[]) => setData((current) => ({ ...current, reports })), []);
  return { ...data, phase, reload, setReports };
}
