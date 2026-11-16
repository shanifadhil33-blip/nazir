'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { messagesFor, type Lang } from '@/components/ocean/copy';
import { useMemberSnapshot } from './member-snapshot';

/** The sample identifies itself on every screen, from trusted account kind only. */
export function DemoBar({ lang }: { lang: Lang }) {
  const snapshot = useMemberSnapshot('');
  if (snapshot?.kind !== 'demo') return null;
  return <DemoBarBody workspaceId={snapshot.workspaceId} lang={lang} />;
}
function DemoBarBody({ workspaceId, lang }: { workspaceId: string; lang: Lang }) {
  const router = useRouter();
  const [reset, setReset] = useState<'idle' | 'ask' | 'busy' | 'failed'>('idle');
  const copy = messagesFor(lang);
  const text = copy.demo;
  async function resetSample() {
    setReset('busy');
    const response = await fetch(`/api/workspaces/${workspaceId}/demo-reset`, { method: 'POST', headers: { 'accept-language': lang } }).catch(() => null);
    if (!response?.ok) { setReset('failed'); return; }
    router.push(`/w/${workspaceId}?lang=${lang}&reset=${Date.now()}`);
  }
  return <details className="nz-demo-bar">
    <summary><span>{text.bar}</span><span className="nz-demo-more">{text.more}</span></summary>
    <div className="nz-demo-bar-body"><p>{text.barOpen}</p>
      <div className="nz-demo-bar-actions"><Link href={`/signin?lang=${lang}`}>{text.ownAccount}</Link><button type="button" onClick={() => setReset('ask')}>{copy.settingsScreen.resetDemo}</button></div>
      {reset === 'ask' || reset === 'busy' ? <div role="group" aria-label={copy.settingsScreen.sure}><p>{copy.settingsScreen.sure}</p><button type="button" disabled={reset === 'busy'} onClick={() => void resetSample()}>{reset === 'busy' ? copy.settingsScreen.working : copy.settingsScreen.yes}</button><button type="button" disabled={reset === 'busy'} onClick={() => setReset('idle')}>{copy.settingsScreen.notNow}</button></div> : null}
      {reset === 'failed' ? <p role="alert">{copy.settingsScreen.failed}</p> : null}
    </div>
  </details>;
}
