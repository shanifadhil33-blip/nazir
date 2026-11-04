'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import type { ReportBody } from '@/server/reports/build';
import { initialsOf } from './people';

type Membership = { workspaceId: string; workspaceName: string; roles: string[] };
export type SavedReport = { id: string; created_at: string; body: ReportBody };
export type LoadedSettings = { name?: string | null; language?: Lang; focus_pack?: string } | null;

export type MemberData = {
  phase: 'loading' | 'ready' | 'error';
  lang: Lang;
  roles: string[];
  assistant: string;
  person: { initials: string; name: string } | undefined;
  fullName: string;
  settings: LoadedSettings;
  reports: SavedReport[];
  reload: () => void;
};

/** The same member APIs the other screens read, so the server decides what each role may see. Reports are skipped when a screen does not need them. */
export function useMemberData(workspaceId: string, initialLang: Lang, withReports: boolean): MemberData {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(initialLang);
  const [phase, setPhase] = useState<MemberData['phase']>('loading');
  const [roles, setRoles] = useState<string[]>([]);
  const [assistant, setAssistant] = useState('');
  const [person, setPerson] = useState<MemberData['person']>();
  const [fullName, setFullName] = useState('');
  const [settings, setSettings] = useState<LoadedSettings>(null);
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [attempt, setAttempt] = useState(0);
  const langRef = useRef(initialLang);
  const pinned = useRef(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).has('lang'));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const headers = { 'accept-language': langRef.current };
      const me = await fetch('/api/me', { headers });
      if (cancelled) return;
      if (me.status === 401) { router.replace('/signin'); return; }
      const meBody = await me.json().catch(() => null);
      const membership = (meBody?.memberships as Membership[] | undefined)?.find((item) => item.workspaceId === workspaceId);
      if (!me.ok || !membership) { setPhase('error'); return; }
      const [settingsResponse, reportsResponse] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/settings`, { headers }).catch(() => null),
        withReports ? fetch(`/api/workspaces/${workspaceId}/reports`, { headers }).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (withReports && !reportsResponse?.ok) { setPhase('error'); return; }
      const loaded = settingsResponse?.ok ? await settingsResponse.json().catch(() => null) as LoadedSettings : null;
      const list = withReports ? await reportsResponse!.json().catch(() => null) as { reports?: SavedReport[] } | null : null;
      if (cancelled) return;
      const name = typeof meBody?.user?.name === 'string' ? meBody.user.name.trim() : '';
      if (!pinned.current && loaded?.language && loaded.language !== langRef.current) { langRef.current = loaded.language; setLang(loaded.language); }
      setSettings(loaded);
      setReports(list?.reports ?? []);
      setRoles(membership.roles);
      setAssistant(loaded?.name || membership.workspaceName);
      setFullName(name);
      setPerson(name ? { name: name.split(/\s+/)[0]!, initials: initialsOf(name) } : undefined);
      setPhase('ready');
    })().catch(() => { if (!cancelled) setPhase('error'); });
    return () => { cancelled = true; };
  }, [router, workspaceId, attempt, withReports]);

  const reload = useCallback(() => { setPhase('loading'); setAttempt((value) => value + 1); }, []);
  return { phase, lang, roles, assistant, person, fullName, settings, reports, reload };
}
