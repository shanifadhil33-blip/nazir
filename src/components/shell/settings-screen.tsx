'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import { signOutAction } from '@/app/actions/sign-out';
import { DocumentLocale } from './document-locale';
import { historyAccess } from './history-model';
import { homeLinks } from './home-model';
import { useMemberData } from './member-data';
import { SettingsViewScreen, type ResetState } from './settings';
import { settingsAccess } from './settings-model';

/** The signed in Settings. Language is saved for this person only; the page then shows in it. */
export function SettingsScreen({ workspaceId, initialLang }: { workspaceId: string; initialLang: Lang }) {
  const data = useMemberData(workspaceId, initialLang, false);
  const router = useRouter();
  const [reset, setReset] = useState<ResetState>('idle');
  const [languageBusy, setLanguageBusy] = useState<Lang | null>(null);
  const [languageFailed, setLanguageFailed] = useState(false);
  const seat = seatFromRoles(data.roles);

  async function confirm() {
    if (reset === 'busy') return;
    setReset('busy');
    const response = await fetch(`/api/workspaces/${workspaceId}/demo-reset`, { method: 'POST', headers: { 'accept-language': data.lang } }).catch(() => null);
    if (!response?.ok) { setReset('failed'); return; }
    setReset('done');
    data.reload();
  }

  async function language(next: Lang) {
    if (languageBusy) return;
    setLanguageBusy(next); setLanguageFailed(false);
    const response = await fetch(`/api/workspaces/${workspaceId}/settings/language`, { method: 'PUT', headers: { 'content-type': 'application/json', 'accept-language': next }, body: JSON.stringify({ language: next }) }).catch(() => null);
    if (!response?.ok) { setLanguageBusy(null); setLanguageFailed(true); return; }
    // Saved for you; every screen now opens in it. The address carries it so this page switches at once.
    router.replace(`/w/${workspaceId}?screen=settings&lang=${next}`);
    setLanguageBusy(null);
  }

  const connection = data.connection;
  let host: string | undefined;
  try { host = connection?.endpoint ? new URL(connection.endpoint).hostname : connection?.host; } catch { host = connection?.host; }
  return <>
    <DocumentLocale lang={data.lang} />
    <SettingsViewScreen
      lang={data.lang} seat={seat} phase={data.phase}
      view={{ demo: data.kind === 'demo', connected: connection?.ready, agentName: connection?.name, kind: connection?.connection_kind, host, assistant: data.assistant, topic: data.settings?.focus_pack ?? 'government', language: data.lang }}
      access={{ ...settingsAccess(data.roles), reset: data.kind === 'demo' && settingsAccess(data.roles).reset }} history={historyAccess(data.roles)} canStart={data.canStart}
      person={data.person} links={homeLinks(workspaceId, data.lang)} reset={reset} languageBusy={languageBusy} languageFailed={languageFailed}
      onLanguage={(next) => void language(next)} onAsk={() => setReset('ask')} onCancel={() => setReset('idle')} onConfirm={() => void confirm()} onRetry={data.reload}
      signOut={signOutAction}
    />
  </>;
}
