'use client';

import { useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { seatFromRoles } from '@/components/ocean/model';
import { DocumentLocale } from './document-locale';
import { storeKeyFor } from './fixes-model';
import { historyAccess } from './history-model';
import { homeLinks } from './home-model';
import { personFor } from './people';
import { useMemberData } from './member-data';
import { SettingsViewScreen, type ResetState } from './settings';
import { roleWord, settingsAccess } from './settings-model';

/** The signed in Settings. Only the member's own row is known to the app, so People lists the signed in person. */
export function SettingsScreen({ workspaceId, initialLang }: { workspaceId: string; initialLang: Lang }) {
  const data = useMemberData(workspaceId, initialLang, false);
  const [peopleOpen, setPeopleOpen] = useState(true);
  const [reset, setReset] = useState<ResetState>('idle');
  const copy = messagesFor(data.lang);
  const seat = seatFromRoles(data.roles);

  async function confirm() {
    if (reset === 'busy') return;
    setReset('busy');
    const response = await fetch(`/api/workspaces/${workspaceId}/demo-reset`, { method: 'POST', headers: { 'accept-language': data.lang } }).catch(() => null);
    if (!response?.ok) { setReset('failed'); return; }
    localStorage.removeItem(storeKeyFor(workspaceId));
    setReset('done');
    data.reload();
  }

  const me = data.person ?? personFor(seat, copy);
  const people = data.phase === 'ready' ? [{ initials: me.initials, name: me.name, role: roleWord(data.roles) }] : [];
  return <>
    <DocumentLocale lang={data.lang} />
    <SettingsViewScreen
      lang={data.lang} seat={seat} phase={data.phase}
      view={{ assistant: data.assistant, topic: data.settings?.focus_pack ?? 'government', language: data.settings?.language ?? data.lang, people }}
      access={settingsAccess(data.roles)} history={historyAccess(data.roles)} canStart={data.roles.some((role) => role === 'service_owner' || role === 'quality_reviewer')}
      person={data.person} links={homeLinks(workspaceId)} peopleOpen={peopleOpen} reset={reset}
      onPeople={() => setPeopleOpen((open) => !open)} onAsk={() => setReset('ask')} onCancel={() => setReset('idle')} onConfirm={() => void confirm()} onRetry={data.reload}
    />
  </>;
}
